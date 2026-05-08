"""
NASDAQ — one CSV per ticker, daily OHLCV + fundamentals.

Format: ISO 8601 UTC dates, USD. Description quote: "volume - Daily trading
volume (USD notional value); shares_traded - Number of shares traded."

Checks:
  1. eps_diluted / book_val_per_sh stored as the literal string '--' instead
     of NaN. Forces dtype=object and breaks numeric ops.
  2. Big price jumps (>40%) — likely an unadjusted stock split.
  3. Negative prices — impossible for equities.
  4. volume vs px_last*shares_traded consistency. The description says volume
     IS notional, so we VERIFY that. If a future export ships share-count
     in the volume column, this check fires.
  5. Date format ISO 8601 UTC sanity (cheap parse + UTC suffix).
"""

from __future__ import annotations
from pathlib import Path
import pandas as pd

from .common import ScanResult


PRICE_FIELDS = ("px_open", "px_high", "px_low", "px_last")
JUMP_THRESHOLD = 0.40   # 40% single-day move


def _check_eps_dash(result: ScanResult, df: pd.DataFrame, sym: str, fname: str):
    """A column that contains the literal string '--' will not parse as numeric.
    Check works regardless of underlying dtype (object, str, StringArray)."""
    flagged = []
    for col in ("eps_diluted", "book_val_per_sh"):
        if col not in df.columns:
            continue
        if pd.api.types.is_numeric_dtype(df[col]):
            continue  # already numeric — nothing to flag
        n = int((df[col].astype(str) == "--").sum())
        if n > 0:
            flagged.append((col, n))
    if flagged:
        cols_desc = ", ".join(f"{c} ({n} rows)" for c, n in flagged)
        result.add(
            document=fname,
            symbol=sym,
            date="multiple",
            category="Type Error",
            severity="warning",
            description=f"Fundamental field(s) contain literal '--' string instead of NaN: {cols_desc}. "
                        f"Forces column dtype=object; numeric operations like .mean() will raise.",
            recommended_fix="df[col] = pd.to_numeric(df[col], errors='coerce') for each affected column.",
        )


def _check_jumps(result: ScanResult, df: pd.DataFrame, sym: str, fname: str):
    if "px_last" not in df.columns:
        return
    pct = df["px_last"].pct_change()
    big = pct.abs() > JUMP_THRESHOLD
    for idx in df.index[big.fillna(False)]:
        prev = float(df["px_last"].iloc[df.index.get_loc(idx) - 1])
        curr = float(df["px_last"].iloc[df.index.get_loc(idx)])
        result.add(
            document=fname,
            symbol=sym,
            date=str(df.loc[idx, "date"]),
            category="Outlier",
            severity="warning",
            description=f"Price jump {prev:.2f} -> {curr:.2f} ({(curr/prev - 1)*100:+.0f}%). "
                        f"Likely an unadjusted stock split or corporate action.",
            recommended_fix=f"Check the corporate-actions calendar for {sym} on this date. "
                            f"If a split, apply backward adjustment factor {curr/prev:.4f} "
                            f"to all pre-split prices.",
        )


def _check_negative_prices(result: ScanResult, df: pd.DataFrame, sym: str, fname: str):
    for col in PRICE_FIELDS:
        if col not in df.columns:
            continue
        bad = df[df[col] < 0]
        if len(bad) > 0:
            result.add(
                document=fname,
                symbol=sym,
                date=str(bad.iloc[0]["date"]),
                category="Outlier",
                severity="critical",
                description=f"Negative value in column '{col}': {float(bad.iloc[0][col]):.4f}. "
                            f"Equity prices cannot be negative.",
                recommended_fix="Re-fetch from BQuant. If repeated, suspect a sign-flip in the export.",
            )


def _check_volume_notional(result: ScanResult, df: pd.DataFrame, sym: str, fname: str):
    """Description claims volume == px_last * shares_traded. Verify."""
    needed = ("volume", "px_last", "shares_traded")
    if not all(c in df.columns for c in needed):
        return
    expected = df["px_last"] * df["shares_traded"]
    # avoid div-by-zero on very thinly traded days
    valid = (expected > 0) & df["volume"].notna()
    if not valid.any():
        return
    rel_err = (df.loc[valid, "volume"] - expected[valid]).abs() / expected[valid].abs()
    bad = rel_err > 0.05  # >5% disagreement
    n_bad = int(bad.sum())
    if n_bad > 0:
        result.add(
            document=fname,
            symbol=sym,
            date="multiple",
            category="Cross-Field Inconsistency",
            severity="warning",
            description=f"{n_bad}/{len(rel_err)} rows where volume disagrees with px_last*shares_traded "
                        f"by more than 5%. Description states volume IS notional value of trades; "
                        f"if violated, the column may have been mistakenly populated with share-count.",
            recommended_fix="Confirm with BQuant: volume should be USD notional. If share-count, "
                            "rename to 'shares_traded' and re-derive notional.",
        )


def _check_calendar_gap(result: ScanResult, df: pd.DataFrame, sym: str, fname: str):
    """Find consecutive missing trading days. A gap of >4 calendar days
    between adjacent rows means we lost at least one trading day (Fri->Mon
    is 3 days; Fri->Tue is 4; anything longer is a missing weekday)."""
    if "date" not in df.columns:
        return
    dates = pd.to_datetime(df["date"], utc=True, errors="coerce").dt.normalize().sort_values().dropna()
    if len(dates) < 2:
        return
    diffs = dates.diff().dt.days
    big = diffs[diffs > 4]
    for idx in big.index:
        prev_date = dates.loc[idx - 1] if (idx - 1) in dates.index else None
        gap_days = int(diffs.loc[idx])
        # rough estimate of missed trading days = gap // 7 * 5 + min(gap % 7, 5) - 1
        # but simpler: subtract weekends from the total
        result.add(
            document=fname,
            symbol=sym,
            date=f"{prev_date.date() if prev_date is not None else '?'} -> {dates.loc[idx].date()}",
            category="Missing Data",
            severity="warning",
            description=f"Calendar gap of {gap_days} days between adjacent rows. "
                        f"Suggests roughly {max(gap_days - 3, 1)} missing trading day(s) "
                        f"(after subtracting one weekend).",
            recommended_fix="Cross-check the NASDAQ trading calendar (no scheduled "
                            "early-close gaps in this period). Likely a vendor feed "
                            "outage. Re-fetch from BQuant.",
        )


def _check_date_format(result: ScanResult, df: pd.DataFrame, sym: str, fname: str):
    if "date" not in df.columns:
        return
    sample = str(df["date"].iloc[0])
    # ISO 8601 with Z suffix per description
    if not (sample.endswith("Z") or "+00:00" in sample):
        result.add(
            document=fname,
            symbol=sym,
            date="all",
            category="Format",
            severity="info",
            description=f"date column sample '{sample}' does not include the UTC marker (Z or +00:00) "
                        f"that the data description promises.",
            recommended_fix="pd.to_datetime(df['date'], utc=True). If the source is naive, "
                            "explicitly localize before joining to other markets.",
        )


def scan(data_dir: Path) -> ScanResult:
    result = ScanResult(market="nasdaq")
    base = data_dir / "nasdaq"
    if not base.exists():
        result.error = f"folder not found: {base}"
        return result

    csvs = sorted(p for p in base.iterdir() if p.suffix == ".csv")
    eps_reported = False  # field-wide issue: report once
    fmt_reported = False

    for fpath in csvs:
        sym = fpath.stem
        try:
            df = pd.read_csv(fpath)
            result.files_scanned += 1

            if not eps_reported:
                # detect on first file then suppress for the rest (it is the
                # SAME issue across all files; flooding the report is noise)
                pre = len(result.issues)
                _check_eps_dash(result, df, sym="ALL", fname="ALL nasdaq CSV files")
                if len(result.issues) > pre:
                    eps_reported = True

            _check_jumps(result, df, sym, fpath.name)
            _check_negative_prices(result, df, sym, fpath.name)
            _check_volume_notional(result, df, sym, fpath.name)
            _check_calendar_gap(result, df, sym, fpath.name)

            if not fmt_reported:
                pre = len(result.issues)
                _check_date_format(result, df, sym="ALL", fname="ALL nasdaq CSV files")
                if len(result.issues) > pre:
                    fmt_reported = True

        except Exception as e:
            result.add(
                document=fpath.name,
                symbol=sym,
                date="N/A",
                category="File Error",
                severity="critical",
                description=f"Failed to read: {type(e).__name__}: {e}",
                recommended_fix="Check encoding and integrity of this single CSV.",
            )

    return result