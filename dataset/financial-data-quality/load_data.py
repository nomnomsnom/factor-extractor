"""
Unified cross-market data API (bonus task).

    load_data(market, key, start=None, end=None) -> pd.DataFrame

Returns a DataFrame with:
    index   : pd.DatetimeIndex (UTC, tz-aware)
    columns : symbol codes (str)
    values  : float64

Hides every vendor's quirks: HDF5 vs CSV, naive vs tz-aware timestamps,
Japanese column names, MM/DD/YYYY vs ISO 8601, '--' string nulls, the
'volume' notional/share-count naming gotcha, etc.

Valid keys per market (extend as needed):
    ashare  : open, high, low, close, volume, turnover (+ same in 30min)
    nasdaq  : px_open, px_high, px_low, px_last, volume, shares_traded,
              eps_diluted, book_val_per_sh
    hkex    : open, high, low, close, vol, turnover
    nyse    : ticker, fiscal_period_end, report_date, accel_dep, adj_net_oth,
              assets_curr, book_val, capex, cash_flow_ops, debt_lt, ebitda,
              eps_diluted, revenue
    tse     : open, high, low, close, volume, turnover (+ Japanese aliases)
"""

from __future__ import annotations
from pathlib import Path
import warnings
import pandas as pd

# Default dataset path (override via DATA_DIR env var or pass explicit path)
DEFAULT_DATA_DIR = Path("ai_agent_dataset")

VALID_MARKETS = ("ashare", "nasdaq", "hkex", "nyse", "tse")


def _filter_dates(df: pd.DataFrame, start: str | None, end: str | None) -> pd.DataFrame:
    if start is not None:
        df = df[df.index >= pd.Timestamp(start, tz="UTC")]
    if end is not None:
        df = df[df.index <= pd.Timestamp(end, tz="UTC") + pd.Timedelta(days=1)]
    return df


def _ashare(key: str, data_dir: Path) -> pd.DataFrame:
    for freq in ("daily", "30min"):
        p = data_dir / "ashare" / freq / f"{key}.h5"
        if p.exists():
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                df = pd.read_hdf(p, key="data")
            df.index = (
                pd.DatetimeIndex(df.index)
                .tz_localize("Asia/Shanghai", nonexistent="shift_forward", ambiguous="NaT")
                .tz_convert("UTC")
            )
            df.columns = df.columns.astype(str)
            return df
    raise ValueError(f"ashare: field '{key}' not found (tried daily/, 30min/)")


def _nasdaq(key: str, data_dir: Path) -> pd.DataFrame:
    base = data_dir / "nasdaq"
    frames: dict[str, pd.Series] = {}
    for fpath in sorted(base.glob("*.csv")):
        df = pd.read_csv(fpath)
        if key not in df.columns or "date" not in df.columns:
            continue
        idx = pd.to_datetime(df["date"], utc=True, errors="coerce")
        s = pd.to_numeric(df[key], errors="coerce")
        frames[fpath.stem] = pd.Series(s.values, index=idx).dropna()
    if not frames:
        raise ValueError(f"nasdaq: field '{key}' not found in any CSV")
    out = pd.DataFrame(frames).sort_index()
    out.index.name = None
    return out


def _hkex(key: str, data_dir: Path) -> pd.DataFrame:
    KEY_MAP = {"close": "Close", "open": "Open", "high": "High",
               "low": "Low", "volume": "Vol", "vol": "Vol", "turnover": "Turnover"}
    suffix = KEY_MAP.get(key.lower(), key)
    p = data_dir / "hkex" / "daily_prices.csv"
    df = pd.read_csv(p)
    matching = {c.split("_")[0]: pd.to_numeric(df[c], errors="coerce")
                for c in df.columns if c.endswith(f"_{suffix}")}
    if not matching:
        raise ValueError(f"hkex: field '{key}' not found")
    # +08:00 already in the string; pd.to_datetime(utc=True) converts properly
    idx = pd.to_datetime(df["Datetime"], utc=True, errors="coerce")
    out = pd.DataFrame(matching, index=idx).sort_index()
    # de-dup on index (we discovered HKEX has duplicate Datetime rows)
    out = out[~out.index.duplicated(keep="first")]
    return out


def _nyse(key: str, data_dir: Path) -> pd.DataFrame:
    frames: list[pd.DataFrame] = []
    for fpath in sorted((data_dir / "nyse").glob("*.h5")):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            df = pd.read_hdf(fpath, key="fundamentals")
        if key not in df.columns:
            continue
        # report_date avoids look-ahead bias
        df = df.copy()
        df["_d"] = pd.to_datetime(df["report_date"], format="%m/%d/%Y", utc=True, errors="coerce")
        df = df.set_index("_d")[["ticker", key]].dropna()
        pivoted = df.pivot_table(index=df.index, columns="ticker", values=key, aggfunc="last")
        frames.append(pivoted)
    if not frames:
        raise ValueError(f"nyse: field '{key}' not found in any snapshot")
    out = pd.concat(frames).sort_index()
    out.columns.name = None
    return out


def _tse(key: str, data_dir: Path) -> pd.DataFrame:
    JP_DAILY = {"open": "始値", "high": "高値", "low": "安値",
                "close": "終値", "volume": "出来高", "turnover": "売買代金"}
    jp_key = JP_DAILY.get(key.lower(), key)
    frames: dict[str, pd.Series] = {}
    for sym_dir in sorted((data_dir / "tse").iterdir()):
        if not sym_dir.is_dir():
            continue
        p = sym_dir / "daily.csv"
        if not p.exists():
            continue
        # try utf-8 first, fall back to cp932 for safety
        try:
            df = pd.read_csv(p, encoding="utf-8")
        except UnicodeDecodeError:
            df = pd.read_csv(p, encoding="cp932")
        if jp_key not in df.columns or "日付" not in df.columns:
            continue
        idx = (
            pd.to_datetime(df["日付"], format="%Y/%m/%d", errors="coerce")
            .dt.tz_localize("Asia/Tokyo")
            .dt.tz_convert("UTC")
        )
        frames[sym_dir.name] = pd.Series(
            pd.to_numeric(df[jp_key], errors="coerce").values,
            index=idx,
        ).dropna()
    if not frames:
        raise ValueError(f"tse: field '{key}' not found in any symbol folder")
    return pd.DataFrame(frames).sort_index()


def load_data(
    market: str,
    key: str,
    start: str | None = None,
    end: str | None = None,
    data_dir: str | Path | None = None,
) -> pd.DataFrame:
    base = Path(data_dir) if data_dir else DEFAULT_DATA_DIR
    if market not in VALID_MARKETS:
        raise ValueError(f"unknown market {market!r}; valid: {VALID_MARKETS}")
    dispatcher = {
        "ashare": _ashare, "nasdaq": _nasdaq, "hkex": _hkex,
        "nyse": _nyse, "tse": _tse,
    }
    df = dispatcher[market](key, base)
    return _filter_dates(df, start, end)