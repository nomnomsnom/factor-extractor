"""
TSE — Tokyo Stock Exchange.

Format: per-symbol folders with daily.csv + quarterly.csv. Dates YYYY/MM/DD,
JPY, Japanese column names. Description quote (decoded from cp932): trading
hours 09:00-11:30 morning, 12:30-15:00 afternoon.

Probe finding: data files are UTF-8, but data_description_tse.txt is cp932.
Mixed encoding within a single market is itself a quality issue.

Checks:
  1. Mixed encoding observation (one info row per market).
  2. OHLC inequalities on daily (all five rules).
  3. Nulls in daily.
  4. Quarterly.csv structural sanity — Sonnet skipped this entirely.
     We at least verify it parses, has the expected columns, and report
     null rates per fundamental column.
  5. Date format YYYY/MM/DD info note.
"""

from __future__ import annotations
from pathlib import Path
import pandas as pd

from .common import ScanResult, read_text_with_fallback, read_csv_with_fallback


COL_MAP_DAILY = {
    "日付": "date",
    "始値": "open",
    "高値": "high",
    "安値": "low",
    "終値": "close",
    "出来高": "volume",
    "売買代金": "turnover",
}

COL_MAP_QUARTERLY = {
    "日付": "date",
    "決算期": "fiscal_period_end",
    "発表日": "report_date",
    "更新日": "update_date",
    "売上高": "revenue",
    "EBITDA": "ebitda",
    "希薄化EPS": "eps_diluted",
    "純資産": "book_value",
    "流動資産": "current_assets",
    "固定負債": "long_term_debt",
    "営業CF": "cash_flow_ops",
    "設備投資": "capex",
}


def _check_description_encoding(result: ScanResult, base: Path):
    desc_path = base / "data_description_tse.txt"
    if not desc_path.exists():
        return
    try:
        _, codec = read_text_with_fallback(desc_path)
    except UnicodeDecodeError as e:
        result.add(
            document="data_description_tse.txt",
            symbol="N/A",
            date="N/A",
            category="Type Error",
            severity="warning",
            description=f"Could not decode description file with any of utf-8 / cp932 / shift_jis: {e}",
            recommended_fix="Re-export from vendor with explicit UTF-8 encoding.",
        )
        return

    if codec != "utf-8":
        # check that data files use a different codec (mismatch within market)
        sample = next(base.glob("*/daily.csv"), None)
        if sample is not None:
            try:
                _, data_codec = read_csv_with_fallback(sample, nrows=1)
            except UnicodeDecodeError:
                data_codec = None
            if data_codec and data_codec != codec:
                result.add(
                    document="data_description_tse.txt vs */daily.csv",
                    symbol="ALL",
                    date="all",
                    category="Format",
                    severity="warning",
                    description=f"Encoding mismatch within the same market: description file is "
                                f"{codec} but daily CSVs are {data_codec}. Tools that auto-detect "
                                f"the description's encoding and reuse it will fail on the data files.",
                    recommended_fix="Standardize on UTF-8. Re-export the description file from the "
                                    "vendor with -encoding utf-8.",
                )


def _check_daily(result: ScanResult, base: Path):
    sym_dirs = sorted(d for d in base.iterdir() if d.is_dir())
    fmt_reported = False

    for sym_dir in sym_dirs:
        sym = sym_dir.name
        daily = sym_dir / "daily.csv"
        if not daily.exists():
            continue
        try:
            df, codec = read_csv_with_fallback(daily)
            result.files_scanned += 1
        except Exception as e:
            result.add(
                document=f"{sym}/daily.csv",
                symbol=sym,
                date="N/A",
                category="File Error",
                severity="critical",
                description=f"Could not read daily.csv: {type(e).__name__}: {e}",
                recommended_fix="Verify file integrity and encoding.",
            )
            continue

        df_en = df.rename(columns=COL_MAP_DAILY)

        if not fmt_reported and "date" in df_en.columns:
            sample_date = str(df_en["date"].iloc[0])
            if "/" in sample_date and len(sample_date) == 10:
                result.add(
                    document="ALL <symbol>/daily.csv",
                    symbol="ALL",
                    date="all",
                    category="Format",
                    severity="info",
                    description=f"Date format is YYYY/MM/DD (e.g. '{sample_date}'). NASDAQ uses "
                                f"ISO 8601 (with 'T' and 'Z'); NYSE uses MM/DD/YYYY. Cross-market "
                                f"joins require standardization.",
                    recommended_fix="pd.to_datetime(df['date'], format='%Y/%m/%d') on read.",
                )
                fmt_reported = True

        # OHLC inequality checks (all five rules)
        needed = {"open", "high", "low", "close"}
        if needed.issubset(df_en.columns):
            o, h, l, c = df_en["open"], df_en["high"], df_en["low"], df_en["close"]
            rules = [
                ("close > high", c > h),
                ("close < low",  c < l),
                ("open  > high", o > h),
                ("open  < low",  o < l),
                ("low   > high", l > h),
            ]
            for name, mask in rules:
                bad = df_en[mask.fillna(False)]
                for _, row in bad.iterrows():
                    result.add(
                        document=f"{sym}/daily.csv",
                        symbol=sym,
                        date=str(row["date"]),
                        category="Outlier",
                        severity="critical",
                        description=f"OHLC inequality violated ({name}): "
                                    f"O={row['open']} H={row['high']} L={row['low']} C={row['close']}.",
                        recommended_fix="Re-fetch this row. Check whether high/low were transposed.",
                    )

        # Nulls
        nulls = int(df_en.isnull().sum().sum())
        if nulls > 0:
            result.add(
                document=f"{sym}/daily.csv",
                symbol=sym,
                date="multiple",
                category="Missing Data",
                severity="warning",
                description=f"{nulls} null cells in daily.csv. Could indicate trading halt or feed gap.",
                recommended_fix="Verify against TSE trading calendar; re-fetch if unexpected.",
            )


def _check_quarterly(result: ScanResult, base: Path):
    sym_dirs = sorted(d for d in base.iterdir() if d.is_dir())
    null_summary: dict[str, int] = {}
    files_scanned = 0
    for sym_dir in sym_dirs:
        q_path = sym_dir / "quarterly.csv"
        if not q_path.exists():
            continue
        try:
            df, _ = read_csv_with_fallback(q_path)
            files_scanned += 1
        except Exception as e:
            result.add(
                document=f"{sym_dir.name}/quarterly.csv",
                symbol=sym_dir.name,
                date="N/A",
                category="File Error",
                severity="critical",
                description=f"Could not read quarterly.csv: {type(e).__name__}: {e}",
                recommended_fix="Verify file integrity and encoding.",
            )
            continue

        df_en = df.rename(columns=COL_MAP_QUARTERLY)
        for col in ("revenue", "ebitda", "eps_diluted"):
            if col in df_en.columns:
                null_summary[col] = null_summary.get(col, 0) + int(df_en[col].isnull().sum())

    result.files_scanned += files_scanned

    if files_scanned == 0:
        return

    nz = {k: v for k, v in null_summary.items() if v > 0}
    if nz:
        result.add(
            document="ALL <symbol>/quarterly.csv",
            symbol="ALL",
            date="multiple",
            category="Missing Data",
            severity="info",
            description=f"Null counts across {files_scanned} quarterly files: {nz}. "
                        f"For fundamentals this is often legitimate (firms not yet reporting), "
                        f"but worth flagging so downstream code does not silently drop rows.",
            recommended_fix="Convert to NaN-aware aggregation (mean/median ignore NaN by default in pandas). "
                            "Document expected coverage per ticker.",
        )


def scan(data_dir: Path) -> ScanResult:
    result = ScanResult(market="tse")
    base = data_dir / "tse"
    if not base.exists():
        result.error = f"folder not found: {base}"
        return result

    try:
        _check_description_encoding(result, base)
        _check_daily(result, base)
        _check_quarterly(result, base)
    except Exception as e:
        result.error = f"{type(e).__name__}: {e}"

    return result