"""
ASHARE — China A-Shares (Shanghai + Shenzhen).

Format: HDF5, one file per field, naive Asia/Shanghai timestamps, CNY.
Description quote: "Index: datetime (naive, local time). Columns: symbol codes."

Checks:
  1. OHLC inequalities (all four): close>high, close<low, open>high, open<low,
     low>high. Sonnet only checked close>high.
  2. Nulls split into HALT (all OHLC fields null on the same row+symbol — a
     legitimate suspension) vs ERROR (some fields null, others not — a
     vendor export bug).
  3. Extreme single-day move >20%. A-share daily limit is 10%, so anything
     above 20% is either a special event (post-halt resume, rights issue) or
     a decimal-point error.
  4. Daily vs 30min cross-check: the LAST 30min bar's close on day D should
     equal daily.close[D]. Free check, since the data is redundantly stored.
"""

from __future__ import annotations
from pathlib import Path
import warnings

import numpy as np
import pandas as pd

from .common import ScanResult


FIELDS = ("open", "high", "low", "close", "volume", "turnover")


def _load_daily(base: Path) -> dict[str, pd.DataFrame]:
    return {f: pd.read_hdf(base / "daily" / f"{f}.h5", key="data") for f in FIELDS}


def _check_ohlc_inequalities(result: ScanResult, dfs: dict[str, pd.DataFrame]):
    o, h, l, c = dfs["open"], dfs["high"], dfs["low"], dfs["close"]
    rules = [
        ("close > high", c > h, c, h, "Close exceeds High"),
        ("close < low",  c < l, c, l, "Close below Low"),
        ("open  > high", o > h, o, h, "Open exceeds High"),
        ("open  < low",  o < l, o, l, "Open below Low"),
        ("low   > high", l > h, l, h, "Low exceeds High"),
    ]
    for name, mask, lhs, rhs, desc in rules:
        for r, c_idx in zip(*np.where(mask.values)):
            sym = lhs.columns[c_idx]
            date = str(lhs.index[r].date())
            lv, rv = float(lhs.iloc[r, c_idx]), float(rhs.iloc[r, c_idx])
            ratio = lv / rv if rv else float("inf")
            fix = f"Re-fetch from WindQuant. "
            if 8 < ratio < 12:
                fix += f"Ratio {ratio:.2f} suggests a 10x decimal error; dividing by 10 gives {lv/10:.3f}."
            else:
                fix += "Likely a vendor export error; transposed or scaled value."
            result.add(
                document=f"daily/{name.split()[0]}.h5, daily/{name.split()[2]}.h5",
                symbol=sym,
                date=date,
                category="Outlier",
                severity="critical",
                description=f"{desc} on {date} for {sym}: {lv:.3f} vs {rv:.3f} ({name}).",
                recommended_fix=fix,
            )


def _check_nulls(result: ScanResult, dfs: dict[str, pd.DataFrame]):
    """Distinguish halt (all fields null) from error (partial nulls)."""
    o, h, l, c = dfs["open"], dfs["high"], dfs["low"], dfs["close"]
    all_null = o.isnull() & h.isnull() & l.isnull() & c.isnull()
    any_null = o.isnull() | h.isnull() | l.isnull() | c.isnull()
    partial_null = any_null & ~all_null

    halt_count = int(all_null.values.sum())
    if halt_count > 0:
        result.add(
            document="daily/{open,high,low,close}.h5",
            symbol="multiple",
            date="multiple",
            category="Missing Data",
            severity="info",
            description=f"{halt_count} rows where ALL OHLC fields are null on the same "
                        f"(symbol, date) — consistent with trading halts/suspensions, not errors.",
            recommended_fix="Treat as expected. Mark with a halt indicator column rather than "
                            "forward-filling, since halt periods carry meaningful information.",
        )

    for r, c_idx in zip(*np.where(partial_null.values)):
        sym = c.columns[c_idx]
        date = str(c.index[r].date())
        which = [f for f in ("open", "high", "low", "close") if pd.isnull(dfs[f].iloc[r, c_idx])]
        result.add(
            document="daily/" + ", ".join(f"{f}.h5" for f in which),
            symbol=sym,
            date=date,
            category="Missing Data",
            severity="warning",
            description=f"Partial nulls on {date} for {sym}: missing {which}, but other OHLC "
                        f"fields present. Inconsistent with a clean halt.",
            recommended_fix="Re-fetch this row from WindQuant. Either all fields should be null "
                            "(halt) or none (regular trading day).",
        )


def _check_extreme_moves(result: ScanResult, dfs: dict[str, pd.DataFrame], threshold_pct: float = 20):
    close = dfs["close"]
    pct = close.pct_change() * 100
    mask = pct.abs() > threshold_pct
    for r, c_idx in zip(*np.where(mask.fillna(False).values)):
        sym = close.columns[c_idx]
        date = str(close.index[r].date())
        v = float(pct.iloc[r, c_idx])
        result.add(
            document="daily/close.h5",
            symbol=sym,
            date=date,
            category="Outlier",
            severity="warning",
            description=f"Single-day move of {v:+.1f}% — A-share normal limit is +/-10%.",
            recommended_fix="Cross-check WindQuant. If real, likely post-halt resumption or "
                            "rights issue; otherwise re-fetch. Apply split/dividend adjustment "
                            "if the underlying corporate action is missing.",
        )


def _check_daily_vs_30min(result: ScanResult, daily: dict[str, pd.DataFrame], data_dir: Path):
    """Last 30min bar's close on day D must match daily.close[D]."""
    intra_path = data_dir / "ashare" / "30min" / "close.h5"
    if not intra_path.exists():
        return
    intra = pd.read_hdf(intra_path, key="data")
    intra.index = pd.DatetimeIndex(intra.index)
    last_per_day = intra.groupby(intra.index.normalize()).last()
    last_per_day.index = last_per_day.index.normalize()

    daily_close = daily["close"].copy()
    daily_close.index = daily_close.index.normalize()

    common_dates = last_per_day.index.intersection(daily_close.index)
    common_syms = last_per_day.columns.intersection(daily_close.columns)
    if len(common_dates) == 0 or len(common_syms) == 0:
        return

    a = last_per_day.loc[common_dates, common_syms].astype(float)
    b = daily_close.loc[common_dates, common_syms].astype(float)
    diff = (a - b).abs()
    rel = diff / b.abs().replace(0, np.nan)
    mismatches = (rel > 0.001) & rel.notna()  # > 0.1% disagreement

    n = int(mismatches.values.sum())
    if n > 0:
        result.add(
            document="daily/close.h5 vs 30min/close.h5",
            symbol="multiple",
            date="multiple",
            category="Cross-File Inconsistency",
            severity="warning",
            description=f"{n} (symbol,date) pairs where the last 30min bar close disagrees "
                        f"with daily close by more than 0.1%. The two feeds describe the same "
                        f"trading day and should agree.",
            recommended_fix="Identify the divergent rows by re-running this check; the daily "
                            "feed and intraday feed are sourced separately at WindQuant. "
                            "Trust whichever is later-stamped or re-fetch both.",
        )


def scan(data_dir: Path) -> ScanResult:
    result = ScanResult(market="ashare")
    base = data_dir / "ashare"
    if not base.exists():
        result.error = f"folder not found: {base}"
        return result

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            dfs = _load_daily(base)
        result.files_scanned = len(FIELDS)

        _check_ohlc_inequalities(result, dfs)
        _check_nulls(result, dfs)
        _check_extreme_moves(result, dfs)
        _check_daily_vs_30min(result, dfs, data_dir)
    except Exception as e:
        result.error = f"{type(e).__name__}: {e}"

    return result