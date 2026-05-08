"""
Cross-market checks — exploit the fact that some companies are listed in
more than one market. Their daily returns must be highly correlated; if not,
one of the feeds is wrong.

Currently covers:
  - BABA (NASDAQ) <-> 9988.HK (HKEX)

We compare daily *returns*, not prices, so currency conversion is not needed.
HKEX trades a few hours before NASDAQ each day, so we shift HK by one day
forward and align on calendar date before correlating.
"""

from __future__ import annotations
from pathlib import Path
import pandas as pd

from .common import ScanResult


def _load_baba(data_dir: Path) -> pd.Series | None:
    """BABA daily close, indexed by local trading-day date (string YYYY-MM-DD)."""
    p = data_dir / "nasdaq" / "BABA.csv"
    if not p.exists():
        return None
    df = pd.read_csv(p)
    if "px_last" not in df.columns or "date" not in df.columns:
        return None
    # NASDAQ "date" is ISO 8601 UTC midnight; the local NY trading day is the same string.
    idx = pd.to_datetime(df["date"], utc=True, errors="coerce").dt.strftime("%Y-%m-%d")
    s = pd.Series(df["px_last"].values, index=idx, name="BABA").dropna()
    s = s[~s.index.duplicated(keep="first")]
    return s.sort_index()


def _load_9988(data_dir: Path) -> pd.Series | None:
    """9988.HK daily close, indexed by local HK trading-day date (string YYYY-MM-DD).
    HKEX Datetime is +08:00 — we use the LOCAL date so 'HK Sep 2' aligns with 'NY Sep 2'."""
    p = data_dir / "hkex" / "daily_prices.csv"
    if not p.exists():
        return None
    df = pd.read_csv(p)
    col = "9988.HK_Close"
    if col not in df.columns or "Datetime" not in df.columns:
        return None
    # parse without UTC conversion so we keep LOCAL date
    ts = pd.to_datetime(df["Datetime"], utc=False, errors="coerce")
    idx = ts.dt.strftime("%Y-%m-%d")
    s = pd.Series(df[col].values, index=idx, name="9988.HK").dropna()
    s = s[~s.index.duplicated(keep="first")]
    return s.sort_index()


def _check_baba_dual_listing(result: ScanResult, data_dir: Path):
    baba = _load_baba(data_dir)
    hk = _load_9988(data_dir)
    if baba is None or hk is None:
        return

    baba_ret = baba.pct_change().dropna()
    hk_ret = hk.pct_change().dropna()

    # Inner-join on local trading-day date string. Then try shifting HK by +/-1 row
    # to test for off-by-one alignment errors and pick the strongest correlation.
    joined = pd.concat([baba_ret.rename("BABA"), hk_ret.rename("HK")], axis=1, join="inner").dropna()
    if len(joined) < 20:
        return

    best_corr = None
    best_lag = None
    for lag in (-1, 0, 1):
        hk_lagged = joined["HK"].shift(lag)
        rho = float(joined["BABA"].corr(hk_lagged))
        if best_corr is None or abs(rho) > abs(best_corr):
            best_corr = rho
            best_lag = lag

    severity = "info"
    desc_prefix = "OK"
    fix = "No action needed."
    if best_corr < 0.3:
        severity = "warning"
        desc_prefix = "LOW"
        fix = ("Investigate one of the feeds. Check date alignment, symbol "
               "mapping (is 9988.HK actually Alibaba on this feed?), and "
               "for unhandled corporate actions like ADR ratio changes.")
    elif best_corr < 0.5:
        severity = "info"
        desc_prefix = "MODERATE"
        fix = "Borderline — verify with a longer history if available."

    result.add(
        document="nasdaq/BABA.csv vs hkex/daily_prices.csv (9988.HK_Close)",
        symbol="BABA / 9988.HK",
        date="all",
        category="Cross-Market Inconsistency",
        severity=severity,
        description=f"{desc_prefix} dual-listing correlation: BABA(NASDAQ) vs 9988.HK(HKEX) "
                    f"daily-return rho = {best_corr:.3f} at lag {best_lag} day(s). "
                    f"Same underlying company; healthy dual listings sit at 0.6-0.9.",
        recommended_fix=fix,
    )


def scan(data_dir: Path) -> ScanResult:
    result = ScanResult(market="cross_market")
    try:
        _check_baba_dual_listing(result, data_dir)
    except Exception as e:
        result.error = f"{type(e).__name__}: {e}"
    return result