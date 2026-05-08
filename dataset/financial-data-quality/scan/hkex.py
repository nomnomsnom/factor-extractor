"""
HKEX — Hong Kong Stock Exchange.

Format: wide CSV. Columns: Datetime + {Symbol}_{Field}. Asia/Hong_Kong tz with
explicit +08:00 offset. Description quote: "Lunch break data is included with
null values." Trading hours 09:30-12:00 then 13:00-16:00.

Checks:
  1. Symbol-x-field completeness: every symbol must have all 6 fields.
  2. Lunch-break null partition: 12:30 nulls expected; nulls at other times
     are vendor errors.
  3. Intraday bar-count per day: should be a fixed integer (count actual
     unique times-of-day; flag days that fall short — feed dropouts).
  4. Trading-hours window: any timestamp outside 09:30-16:00 is suspect.
  5. tz offset consistency.
"""

from __future__ import annotations
from pathlib import Path
import pandas as pd

from .common import ScanResult


EXPECTED_FIELDS = ("Open", "High", "Low", "Close", "Vol", "Turnover")


def _split_columns(cols: list[str]) -> dict[str, set[str]]:
    """Map symbol -> set of fields present."""
    out: dict[str, set[str]] = {}
    for c in cols:
        if "_" not in c or c == "Datetime":
            continue
        sym, _, fld = c.rpartition("_")
        out.setdefault(sym, set()).add(fld)
    return out


def _check_field_completeness(result: ScanResult, df: pd.DataFrame, doc: str):
    by_sym = _split_columns(list(df.columns))
    for sym, fields in sorted(by_sym.items()):
        missing = sorted(set(EXPECTED_FIELDS) - fields)
        if missing:
            result.add(
                document=doc,
                symbol=sym,
                date="all",
                category="Missing Data",
                severity="warning",
                description=f"Symbol {sym} is missing field columns {missing}; "
                            f"each symbol should have all six of {list(EXPECTED_FIELDS)}.",
                recommended_fix="Re-request the missing fields from RefinData. "
                                "Wide-format files should always emit a complete grid.",
            )


def _check_lunch_break_nulls(result: ScanResult, df: pd.DataFrame):
    """12:30 nulls are documented; nulls at other intraday times are not."""
    if "Datetime" not in df.columns:
        return
    ts = pd.to_datetime(df["Datetime"], utc=False, errors="coerce")
    hhmm = ts.dt.strftime("%H:%M")

    close_cols = [c for c in df.columns if c.endswith("_Close")]
    if not close_cols:
        return

    null_mask = df[close_cols].isnull()
    is_lunch = hhmm == "12:30"

    null_at_lunch = int(null_mask[is_lunch].values.sum())
    null_elsewhere = int(null_mask[~is_lunch].values.sum())

    if null_at_lunch > 0:
        result.add(
            document="intraday_30min.csv",
            symbol="ALL",
            date="all",
            category="Missing Data",
            severity="info",
            description=f"{null_at_lunch} null Close values at 12:30 (lunch break) across all symbols. "
                        f"This is the documented expected behaviour for HKEX intraday.",
            recommended_fix="Drop or skip 12:30 rows before analysis. Do NOT forward-fill — "
                            "post-lunch prices reflect new information.",
        )
    if null_elsewhere > 0:
        result.add(
            document="intraday_30min.csv",
            symbol="multiple",
            date="multiple",
            category="Missing Data",
            severity="warning",
            description=f"{null_elsewhere} null Close values OUTSIDE the 12:30 lunch break. "
                        f"Not explained by the data description.",
            recommended_fix="Inspect by symbol/date. Likely feed outage; re-request from RefinData.",
        )


def _check_bar_count(result: ScanResult, df: pd.DataFrame):
    """Each trading day should produce the same count of intraday bars."""
    if "Datetime" not in df.columns:
        return
    ts = pd.to_datetime(df["Datetime"], utc=False, errors="coerce")
    per_day = ts.groupby(ts.dt.date).size()
    if per_day.empty:
        return

    mode = int(per_day.mode().iloc[0])
    short_days = per_day[per_day < mode]
    if len(short_days) > 0:
        result.add(
            document="intraday_30min.csv",
            symbol="ALL",
            date=", ".join(str(d) for d in short_days.index[:5]) + ("..." if len(short_days) > 5 else ""),
            category="Missing Data",
            severity="warning",
            description=f"{len(short_days)} trading day(s) have fewer than the typical "
                        f"{mode} intraday bars. Suggests feed dropout or partial trading day.",
            recommended_fix="Cross-check the HKEX trading calendar (typhoon early-close days "
                            "are real); for normal days re-request from RefinData.",
        )

    # also flag the absolute count vs textbook expectation
    # 09:30-12:00 = 5 bars at 30min, 13:00-16:00 = 6 bars = 11 bars typical (some vendors emit 13)
    if mode not in (11, 12, 13):
        result.add(
            document="intraday_30min.csv",
            symbol="ALL",
            date="all",
            category="Format",
            severity="info",
            description=f"Typical intraday bar count per day is {mode}. HKEX trading hours "
                        f"(09:30-12:00 + 13:00-16:00) suggest 11-13 bars depending on bar-edge "
                        f"convention. Verify the vendor's bar-stamp policy (open-vs-close).",
            recommended_fix="Document the vendor's bar-edge convention before aligning to other markets.",
        )


def _check_trading_hours_window(result: ScanResult, df: pd.DataFrame):
    if "Datetime" not in df.columns:
        return
    ts = pd.to_datetime(df["Datetime"], utc=False, errors="coerce")
    hhmm = ts.dt.strftime("%H:%M")
    # any non-midnight stamp must be within 09:30..16:00
    out_of_hours = ts[(hhmm != "00:00") & ((hhmm < "09:30") | (hhmm > "16:00"))]
    if len(out_of_hours) > 0:
        result.add(
            document="intraday_30min.csv",
            symbol="ALL",
            date="multiple",
            category="Format",
            severity="warning",
            description=f"{len(out_of_hours)} intraday timestamps fall outside HKEX trading "
                        f"hours (09:30-16:00). Examples: {list(out_of_hours.head(3).astype(str))}.",
            recommended_fix="Likely a timezone or bar-edge convention bug. Confirm with RefinData "
                            "whether stamps mark bar OPEN or bar CLOSE.",
        )


def _check_duplicate_timestamps(result: ScanResult, df: pd.DataFrame, doc: str):
    if "Datetime" not in df.columns:
        return
    dups = df["Datetime"][df["Datetime"].duplicated(keep=False)]
    if len(dups) > 0:
        result.add(
            document=doc,
            symbol="ALL",
            date=", ".join(sorted(set(dups.astype(str)))[:5]) + ("..." if dups.nunique() > 5 else ""),
            category="Cross-Field Inconsistency",
            severity="warning",
            description=f"{len(dups)} rows share Datetime values with another row "
                        f"({dups.nunique()} duplicate keys total). A wide-format file should have "
                        f"one row per timestamp.",
            recommended_fix="De-duplicate on read: df = df.drop_duplicates(subset='Datetime'). "
                            "Investigate the vendor pipeline — duplicates often indicate a botched "
                            "incremental refresh.",
        )


def _check_tz_offset(result: ScanResult, df: pd.DataFrame, doc: str):
    if "Datetime" not in df.columns:
        return
    sample = str(df["Datetime"].iloc[0])
    # description says +08:00 should be embedded
    if "+08:00" not in sample and "+0800" not in sample:
        result.add(
            document=doc,
            symbol="ALL",
            date="all",
            category="Format",
            severity="info",
            description=f"Datetime sample '{sample}' does not include the +08:00 offset that "
                        f"the data description promises. Cross-market joins will mistreat these "
                        f"as naive local time.",
            recommended_fix="Localize on read: pd.to_datetime(df['Datetime']).dt.tz_localize('Asia/Hong_Kong').",
        )


def scan(data_dir: Path) -> ScanResult:
    result = ScanResult(market="hkex")
    base = data_dir / "hkex"
    if not base.exists():
        result.error = f"folder not found: {base}"
        return result

    try:
        daily = pd.read_csv(base / "daily_prices.csv")
        intra = pd.read_csv(base / "intraday_30min.csv")
        result.files_scanned = 2

        _check_field_completeness(result, daily, "daily_prices.csv")
        _check_field_completeness(result, intra, "intraday_30min.csv")
        _check_duplicate_timestamps(result, daily, "daily_prices.csv")
        _check_duplicate_timestamps(result, intra, "intraday_30min.csv")
        _check_lunch_break_nulls(result, intra)
        _check_bar_count(result, intra)
        _check_trading_hours_window(result, intra)
        _check_tz_offset(result, daily, "daily_prices.csv")
        _check_tz_offset(result, intra, "intraday_30min.csv")
    except Exception as e:
        result.error = f"{type(e).__name__}: {e}"

    return result