"""
Cross-market checks — exploit the fact that some companies are listed in
more than one market. Their daily returns must be highly correlated; if
not, one of the feeds is wrong.

Pairs covered:
  - BABA (NASDAQ)   <-> 9988.HK (HKEX)
  - 601318 (ashare) <-> 2318.HK  (HKEX)   — Ping An Insurance

We compare daily *returns*, not prices, so currency conversion is not
needed. We try lag-shifts of -1/0/+1 row positions to catch off-by-one
alignment errors.
"""

from __future__ import annotations
from pathlib import Path
import warnings
import pandas as pd

from .common import ScanResult


def _load_nasdaq(data_dir: Path, sym: str) -> pd.Series | None:
    p = data_dir / "nasdaq" / f"{sym}.csv"
    if not p.exists():
        return None
    df = pd.read_csv(p)
    if "px_last" not in df.columns or "date" not in df.columns:
        return None
    idx = pd.to_datetime(df["date"], utc=True, errors="coerce").dt.strftime("%Y-%m-%d")
    s = pd.Series(df["px_last"].values, index=idx, name=sym).dropna()
    return s[~s.index.duplicated(keep="first")].sort_index()


def _load_hkex(data_dir: Path, sym: str) -> pd.Series | None:
    p = data_dir / "hkex" / "daily_prices.csv"
    if not p.exists():
        return None
    df = pd.read_csv(p)
    col = f"{sym}_Close"
    if col not in df.columns or "Datetime" not in df.columns:
        return None
    ts = pd.to_datetime(df["Datetime"], utc=False, errors="coerce")
    idx = ts.dt.strftime("%Y-%m-%d")
    s = pd.Series(df[col].values, index=idx, name=sym).dropna()
    return s[~s.index.duplicated(keep="first")].sort_index()


def _load_ashare(data_dir: Path, sym: str) -> pd.Series | None:
    p = data_dir / "ashare" / "daily" / "close.h5"
    if not p.exists():
        return None
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        df = pd.read_hdf(p, key="data")
    df.columns = df.columns.astype(str)
    if sym not in df.columns:
        return None
    s = pd.Series(
        df[sym].values,
        index=pd.DatetimeIndex(df.index).strftime("%Y-%m-%d"),
        name=sym,
    ).dropna()
    return s[~s.index.duplicated(keep="first")].sort_index()


def _correlate_pair(
    result: ScanResult,
    a: pd.Series, a_name: str, a_doc: str,
    b: pd.Series, b_name: str, b_doc: str,
):
    a_ret = a.pct_change().dropna()
    b_ret = b.pct_change().dropna()
    joined = pd.concat([a_ret.rename("A"), b_ret.rename("B")], axis=1, join="inner").dropna()
    if len(joined) < 20:
        return

    best_corr, best_lag = None, None
    for lag in (-1, 0, 1):
        b_lagged = joined["B"].shift(lag)
        rho = float(joined["A"].corr(b_lagged))
        if best_corr is None or abs(rho) > abs(best_corr):
            best_corr, best_lag = rho, lag
    if best_corr is None:
        return

    # Pinpoint the worst-disagreement day. Useful when one feed is broken
    # on a specific date (e.g. 601318's decimal error on 2025-11-20).
    sq_resid = (joined["A"] - joined["B"]) ** 2
    worst_date = sq_resid.idxmax() if len(sq_resid) > 0 else None
    worst_a = float(joined.loc[worst_date, "A"]) if worst_date else 0.0
    worst_b = float(joined.loc[worst_date, "B"]) if worst_date else 0.0

    severity, desc_prefix, fix = "info", "OK", "No action needed."
    if best_corr < 0.3:
        severity = "warning"
        desc_prefix = "LOW"
        fix = ("Investigate one of the feeds. Check date alignment, symbol mapping, "
               "FX rate, or unhandled corporate actions. The worst-day "
               "disagreement above is a good starting point.")
    elif best_corr < 0.5:
        severity = "info"
        desc_prefix = "MODERATE"
        fix = "Borderline — verify with a longer history if available."

    result.add(
        document=f"{a_doc} vs {b_doc}",
        symbol=f"{a_name} / {b_name}",
        date=str(worst_date) if worst_date else "all",
        category="Cross-Market Inconsistency",
        severity=severity,
        description=f"{desc_prefix} dual-listing correlation: {a_name} vs {b_name} "
                    f"daily-return rho = {best_corr:.3f} at lag {best_lag} day(s). "
                    f"Worst-disagreement day: {worst_date} "
                    f"({a_name} {worst_a*100:+.1f}% vs {b_name} {worst_b*100:+.1f}%). "
                    f"Same underlying company; healthy dual listings sit at 0.6-0.9.",
        recommended_fix=fix,
    )


def _check_baba(result: ScanResult, data_dir: Path):
    a = _load_nasdaq(data_dir, "BABA")
    b = _load_hkex(data_dir, "9988.HK")
    if a is None or b is None:
        return
    _correlate_pair(
        result,
        a, "BABA", "nasdaq/BABA.csv",
        b, "9988.HK", "hkex/daily_prices.csv (9988.HK_Close)",
    )


def _check_pingan(result: ScanResult, data_dir: Path):
    a = _load_ashare(data_dir, "601318")
    b = _load_hkex(data_dir, "2318.HK")
    if a is None or b is None:
        return
    _correlate_pair(
        result,
        a, "601318", "ashare/daily/close.h5 (601318)",
        b, "2318.HK", "hkex/daily_prices.csv (2318.HK_Close)",
    )


def scan(data_dir: Path) -> ScanResult:
    result = ScanResult(market="cross_market")
    try:
        _check_baba(result, data_dir)
        _check_pingan(result, data_dir)
    except Exception as e:
        result.error = f"{type(e).__name__}: {e}"
    return result