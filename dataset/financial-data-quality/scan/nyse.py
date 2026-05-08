"""
NYSE — quarterly fundamentals only.

Format: HDF5 per fiscal-quarter-end snapshot (3 files), MM/DD/YYYY dates,
US/Eastern timestamps with explicit tz_offset column. Description quote:
"Use report_date (not fiscal_period_end) to avoid look-ahead bias."

Checks:
  1. Date format MM/DD/YYYY flagged as INFO. Not corrupt — but a footgun
     when joining to other markets that use ISO 8601.
  2. Look-ahead bias methodology warning. The data ships with both fiscal
     end and report_date; users who pick the wrong one introduce bias.
  3. Snapshot coverage observation. Probing this dataset showed each
     snapshot file contains ONLY its own quarter (no overlap across files),
     so historical point-in-time reconstruction is impossible from these
     three files. Worth flagging since real production NYSE feeds usually
     do carry overlapping history.
  4. tz_offset value sanity (US/Eastern is -04:00 EDT or -05:00 EST).
  5. Report-date lag sanity: report_date should be after fiscal_period_end
     by 0-90 days. Flag any row violating that.
"""

from __future__ import annotations
from pathlib import Path
import pandas as pd

from .common import ScanResult
from . import generic


FUNDAMENTAL_FIELDS = (
    "accel_dep", "adj_net_oth", "assets_curr", "book_val", "capex",
    "cash_flow_ops", "debt_lt", "ebitda", "eps_diluted", "revenue",
)


def _check_date_format(result: ScanResult):
    result.add(
        document="ALL .h5 files",
        symbol="ALL",
        date="all",
        category="Format",
        severity="info",
        description="fiscal_period_end / report_date / update_timestamp use MM/DD/YYYY format. "
                    "Other markets use ISO 8601 (YYYY-MM-DD). The dates themselves are valid; "
                    "the inconsistency causes silent locale-dependent mis-parsing on cross-market joins.",
        recommended_fix="On read: pd.to_datetime(df['fiscal_period_end'], format='%m/%d/%Y'). "
                        "Then standardize to ISO before joining with NASDAQ/HKEX/etc.",
    )


def _check_lookahead_methodology(result: ScanResult):
    result.add(
        document="ALL .h5 files",
        symbol="ALL",
        date="all",
        category="Methodology Warning",
        severity="warning",
        description="Both fiscal_period_end and report_date are present. Using fiscal_period_end "
                    "as the data-availability date introduces look-ahead bias — companies typically "
                    "file weeks-to-months after quarter end. Backtests using fiscal_period_end will "
                    "perform unrealistically well.",
        recommended_fix="Always filter by report_date: df[df['report_date'] <= analysis_date]. "
                        "Treat fiscal_period_end as metadata, not as a timestamp.",
    )


def _check_snapshot_coverage(result: ScanResult, snaps: dict[str, pd.DataFrame]):
    overlap_count = 0
    seen: set[tuple[str, str]] = set()
    for name, df in snaps.items():
        for _, row in df.iterrows():
            key = (row["ticker"], row["fiscal_period_end"])
            if key in seen:
                overlap_count += 1
            else:
                seen.add(key)

    if overlap_count == 0 and len(snaps) > 1:
        result.add(
            document=", ".join(sorted(snaps.keys())),
            symbol="ALL",
            date="all",
            category="Methodology Warning",
            severity="info",
            description=f"None of the {len(snaps)} snapshot files share any (ticker, fiscal_period_end) "
                        f"row. Each file contains only the single quarter that matches its own filename. "
                        f"Production NYSE feeds usually carry overlapping history so users can detect "
                        f"vendor restatements; the absence of overlap here means the dataset cannot be "
                        f"used to verify point-in-time stability.",
            recommended_fix="Request that FactQuant emit cumulative snapshots (every snapshot includes "
                            "all prior quarters) rather than per-quarter slices.",
        )


def _us_eastern_offset_for(date: pd.Timestamp) -> str:
    """Return -04:00 (EDT) if `date` is during US DST, else -05:00 (EST).

    DST in the US: starts second Sunday of March, ends first Sunday of November.
    For 2025: starts 2025-03-09, ends 2025-11-02.
    """
    year = date.year
    # 2nd Sunday of March
    march = pd.Timestamp(year=year, month=3, day=1)
    march_2nd_sun = march + pd.Timedelta(days=(6 - march.weekday()) % 7) + pd.Timedelta(days=7)
    # 1st Sunday of November
    nov = pd.Timestamp(year=year, month=11, day=1)
    nov_1st_sun = nov + pd.Timedelta(days=(6 - nov.weekday()) % 7)
    in_dst = march_2nd_sun <= date < nov_1st_sun
    return "-04:00" if in_dst else "-05:00"


def _check_tz_offset(result: ScanResult, df: pd.DataFrame, fname: str):
    """Verify tz_offset matches the DST regime of update_timestamp.

    Per the data description, US/Eastern is -04:00 (EDT) during DST and
    -05:00 (EST) outside DST. We've observed at least one snapshot where
    rows updated in mid-December (post-DST) are still stamped -04:00 —
    a real bug.
    """
    if not {"tz_offset", "update_timestamp"}.issubset(df.columns):
        return
    ts = pd.to_datetime(df["update_timestamp"], format="%m/%d/%Y", errors="coerce")
    actual = df["tz_offset"].astype(str)

    # First: anything outside the legal {-04:00, -05:00} set is its own issue.
    # We surface that and EXCLUDE those rows from the DST-regime check below
    # so each row is flagged at most once per scanner run.
    legal = {"-04:00", "-05:00"}
    odd_mask = ~actual.isin(legal | {"nan", "None"})
    odd_vals = sorted(set(actual[odd_mask].unique()))
    if odd_vals:
        result.add(
            document=fname,
            symbol="ALL",
            date="all",
            category="Format",
            severity="warning",
            description=f"tz_offset column contains unexpected values {odd_vals}. "
                        f"US/Eastern should be either -04:00 (EDT) or -05:00 (EST).",
            recommended_fix="Verify with FactQuant.",
        )

    # DST-regime check, but only on rows where tz_offset IS in the legal set.
    in_legal = actual.isin(legal) & ts.notna()
    expected = ts.where(in_legal).apply(
        lambda t: _us_eastern_offset_for(t) if pd.notnull(t) else None
    )
    mismatched = in_legal & (actual != expected)
    n = int(mismatched.sum())
    if n > 0:
        idx0 = mismatched[mismatched].index[0]
        ts0 = ts.loc[idx0]
        result.add(
            document=fname,
            symbol="ALL",
            date=str(ts0.date()),
            category="Format",
            severity="warning",
            description=f"{n} row(s) where tz_offset disagrees with the DST regime of "
                        f"update_timestamp. Example: update_timestamp={ts0.date()} "
                        f"is stamped {actual.loc[idx0]} but should be {expected.loc[idx0]} "
                        f"(US DST 2025 ran 03/09 to 11/02). Downstream code that converts to UTC "
                        f"using tz_offset will land on the wrong absolute time by 1 hour.",
            recommended_fix="Verify with FactQuant. Either re-derive tz_offset from the timestamp, "
                            "or convert to UTC by parsing the date with America/New_York and "
                            "letting pandas pick the correct offset automatically.",
        )


def _check_report_lag(result: ScanResult, df: pd.DataFrame, fname: str):
    if not {"fiscal_period_end", "report_date"}.issubset(df.columns):
        return
    fpe = pd.to_datetime(df["fiscal_period_end"], format="%m/%d/%Y", errors="coerce")
    rep = pd.to_datetime(df["report_date"], format="%m/%d/%Y", errors="coerce")
    lag_days = (rep - fpe).dt.days
    bad_negative = df[lag_days < 0]
    bad_huge = df[lag_days > 120]
    for _, row in bad_negative.iterrows():
        result.add(
            document=fname,
            symbol=row["ticker"],
            date=str(row["fiscal_period_end"]),
            category="Outlier",
            severity="critical",
            description=f"report_date ({row['report_date']}) is BEFORE fiscal_period_end "
                        f"({row['fiscal_period_end']}). Companies cannot file before the period ends.",
            recommended_fix="Re-fetch this row from FactQuant. Either fiscal_period_end is wrong "
                            "or report_date is.",
        )
    for _, row in bad_huge.iterrows():
        result.add(
            document=fname,
            symbol=row["ticker"],
            date=str(row["fiscal_period_end"]),
            category="Outlier",
            severity="warning",
            description=f"report_date ({row['report_date']}) is more than 120 days after "
                        f"fiscal_period_end ({row['fiscal_period_end']}). 10-K/10-Q filings "
                        f"are normally within ~75-90 days; this is unusually late.",
            recommended_fix="Verify with EDGAR/SEC filings. Could be a delinquent filer, "
                            "amended filing, or a vendor data error.",
        )


def scan(data_dir: Path) -> ScanResult:
    result = ScanResult(market="nyse")
    base = data_dir / "nyse"
    if not base.exists():
        result.error = f"folder not found: {base}"
        return result

    h5s = sorted(p for p in base.iterdir() if p.suffix == ".h5")
    snaps: dict[str, pd.DataFrame] = {}
    for fpath in h5s:
        try:
            df = pd.read_hdf(fpath, key="fundamentals")
            snaps[fpath.stem] = df
            result.files_scanned += 1
        except Exception as e:
            result.add(
                document=fpath.name,
                symbol="N/A",
                date="N/A",
                category="File Error",
                severity="critical",
                description=f"Failed to read: {type(e).__name__}: {e}",
                recommended_fix="Check HDF5 integrity.",
            )

    if not snaps:
        return result

    _check_date_format(result)
    _check_lookahead_methodology(result)
    _check_snapshot_coverage(result, snaps)

    for name, df in snaps.items():
        fname = f"{name}.h5"
        # Tier 1: schema (ticker + the date columns + fundamentals)
        generic.check_columns(
            result, df,
            document=fname,
            expected=["ticker", "fiscal_period_end", "report_date", "update_timestamp",
                      "tz_offset"] + list(FUNDAMENTAL_FIELDS),
        )
        # Tier 2: completeness (per-column null rates) and duplicate
        # (ticker, fiscal_period_end) keys — same row should not appear
        # twice in the same snapshot.
        generic.check_completeness_summary(result, df, document=fname)
        generic.check_no_duplicate_keys(
            result, df,
            document=fname,
            key_columns=["ticker", "fiscal_period_end"],
        )
        # Tier 3: numeric dtype on every fundamental column.
        generic.check_numeric_columns(
            result, df,
            document=fname,
            numeric_columns=list(FUNDAMENTAL_FIELDS),
        )

        _check_tz_offset(result, df, fname)
        _check_report_lag(result, df, fname)

    return result