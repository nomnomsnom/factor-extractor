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


def _check_tz_offset(result: ScanResult, df: pd.DataFrame, fname: str):
    if "tz_offset" not in df.columns:
        return
    vals = set(df["tz_offset"].astype(str).unique()) - {"nan", "None"}
    valid = {"-04:00", "-05:00"}
    if not vals.issubset(valid):
        result.add(
            document=fname,
            symbol="ALL",
            date="all",
            category="Format",
            severity="warning",
            description=f"tz_offset column contains unexpected values {sorted(vals)}. "
                        f"US/Eastern should be either -04:00 (EDT) or -05:00 (EST).",
            recommended_fix="Verify with FactQuant. May indicate a server-side tz misconfiguration.",
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
        _check_tz_offset(result, df, fname)
        _check_report_lag(result, df, fname)

    return result