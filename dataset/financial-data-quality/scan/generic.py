"""
Generic checks that apply to every market — three tiers:

  Tier 1 (schema)        — Are the expected files present? Do tables have
                           the expected columns?
  Tier 2 (completeness)  — Per-column null rates; per-key duplicates.
  Tier 3 (validity)      — Numeric columns parse as numeric; positive-only
                           columns are non-negative.

Each market scanner imports this module and calls the helpers with a small
manifest describing what it expects. Issues raised here use the same
ScanResult.add() interface as the per-market checks.

De-duplication policy. A market scanner that has its own targeted check
covering the same underlying problem should pass `suppress_columns=...` to
the relevant generic helper so the same row is not flagged twice. For
example, NASDAQ's `_check_eps_dash` already explains why eps_diluted is
non-numeric; the generic numeric-dtype check then suppresses those columns.
"""

from __future__ import annotations
from pathlib import Path
import pandas as pd

from .common import ScanResult


# --- Tier 1: schema -------------------------------------------------------

def check_files_exist(result: ScanResult, base: Path, expected: list[str]) -> list[str]:
    """Verify every relpath under `base` exists. Return the list that did
    exist (so the caller can scan them). Missing files raise one critical
    issue per missing path."""
    present = []
    for rel in expected:
        if (base / rel).exists():
            present.append(rel)
        else:
            result.add(
                document=rel,
                symbol="N/A",
                date="N/A",
                category="Schema",
                severity="critical",
                description=f"Expected file '{rel}' is missing from {base.name}/. "
                            f"Downstream code that loads it will raise FileNotFoundError.",
                recommended_fix=f"Re-request '{rel}' from the vendor and place it under {base.name}/.",
            )
    return present


def check_columns(
    result: ScanResult,
    df: pd.DataFrame,
    document: str,
    expected: list[str],
    *,
    flag_extras: bool = False,
    symbol: str = "ALL",
):
    """Every column in `expected` must be in df. If flag_extras is True,
    also flag columns present in df but not in `expected`."""
    actual = list(df.columns)
    missing = [c for c in expected if c not in actual]
    extras = [c for c in actual if c not in expected] if flag_extras else []
    if missing:
        result.add(
            document=document,
            symbol=symbol,
            date="all",
            category="Schema",
            severity="warning",
            description=f"Missing expected column(s) {missing}. Required for downstream "
                        f"checks; their absence likely means the vendor changed the export "
                        f"shape.",
            recommended_fix=f"Re-export with the documented schema, or update the manifest "
                            f"if the schema change was intentional.",
        )
    if extras:
        result.add(
            document=document,
            symbol=symbol,
            date="all",
            category="Schema",
            severity="info",
            description=f"Unexpected extra column(s) {extras}. Not necessarily an error, "
                        f"but the data description does not list them.",
            recommended_fix="Confirm with vendor whether the extras are documented.",
        )


# --- Tier 2: completeness -------------------------------------------------

def check_completeness_summary(
    result: ScanResult,
    df: pd.DataFrame,
    document: str,
    *,
    suppress_columns: set[str] | None = None,
    symbol: str = "ALL",
    severity: str = "info",
):
    """Emit one info row per file when any column has >=5% null rate.
    Columns in `suppress_columns` are skipped (the market scanner has a
    dedicated check covering them and we don't want to double-count)."""
    suppress = suppress_columns or set()
    flagged = []
    for col in df.columns:
        if col in suppress:
            continue
        n_null = int(df[col].isnull().sum())
        if n_null == 0:
            continue
        frac = n_null / len(df) if len(df) else 0
        if frac >= 0.05:
            flagged.append((col, n_null, frac))
    if flagged:
        sample = ", ".join(f"{c} ({n}/{len(df)} = {f*100:.0f}%)" for c, n, f in flagged[:5])
        more = "" if len(flagged) <= 5 else f"; +{len(flagged) - 5} more columns"
        result.add(
            document=document,
            symbol=symbol,
            date="multiple",
            category="Missing Data",
            severity=severity,
            description=f"Column(s) with >=5% null rate: {sample}{more}.",
            recommended_fix="Check whether the missing-ness is documented (e.g. lunch-break, "
                            "non-reporting periods). If not, re-request from the vendor.",
        )


def check_no_duplicate_keys(
    result: ScanResult,
    df: pd.DataFrame,
    document: str,
    key_columns: list[str],
    *,
    symbol: str = "ALL",
    severity: str = "warning",
):
    """Flag rows that share `key_columns` with another row. Works with one
    column or several (composite key)."""
    if not all(c in df.columns for c in key_columns):
        return
    dup_mask = df.duplicated(subset=key_columns, keep=False)
    n = int(dup_mask.sum())
    if n == 0:
        return
    sample_keys = (
        df.loc[dup_mask, key_columns].astype(str).agg(" | ".join, axis=1)
        if len(key_columns) > 1
        else df.loc[dup_mask, key_columns[0]].astype(str)
    )
    uniq = sorted(set(sample_keys))
    result.add(
        document=document,
        symbol=symbol,
        date=", ".join(uniq[:3]) + ("..." if len(uniq) > 3 else ""),
        category="Cross-Field Inconsistency",
        severity=severity,
        description=f"{n} rows share {key_columns} with another row "
                    f"({len(uniq)} duplicate keys). Each key combination should be unique.",
        recommended_fix=f"De-duplicate on read: df.drop_duplicates(subset={key_columns}). "
                        f"Then investigate the vendor pipeline for the source of duplicates.",
    )


# --- Tier 3: validity -----------------------------------------------------

def check_numeric_columns(
    result: ScanResult,
    df: pd.DataFrame,
    document: str,
    numeric_columns: list[str],
    *,
    suppress_columns: set[str] | None = None,
    symbol: str = "ALL",
):
    """Each named column must have a numeric dtype (or be entirely null).
    Columns in `suppress_columns` are skipped (a market-specific check
    already explains why they're non-numeric)."""
    suppress = suppress_columns or set()
    bad = []
    for col in numeric_columns:
        if col in suppress or col not in df.columns:
            continue
        if df[col].isnull().all():
            continue
        if not pd.api.types.is_numeric_dtype(df[col]):
            bad.append(col)
    if bad:
        result.add(
            document=document,
            symbol=symbol,
            date="all",
            category="Type Error",
            severity="warning",
            description=f"Column(s) expected to be numeric have non-numeric dtype: {bad}. "
                        f"Operations like .mean() / .pct_change() will raise.",
            recommended_fix="On read: df[col] = pd.to_numeric(df[col], errors='coerce') "
                            "for each affected column.",
        )


def check_no_negative(
    result: ScanResult,
    df: pd.DataFrame,
    document: str,
    positive_columns: list[str],
    *,
    suppress_columns: set[str] | None = None,
    symbol: str = "ALL",
    severity: str = "critical",
):
    """Columns that should be non-negative (prices, volumes, turnover).
    Skips non-numeric columns silently — that's the dtype check's job."""
    suppress = suppress_columns or set()
    for col in positive_columns:
        if col in suppress or col not in df.columns:
            continue
        if not pd.api.types.is_numeric_dtype(df[col]):
            continue
        bad_n = int((df[col] < 0).sum())
        if bad_n == 0:
            continue
        first_bad = df.loc[df[col] < 0].iloc[0]
        result.add(
            document=document,
            symbol=symbol,
            date=str(first_bad.get("date", first_bad.get("Datetime", "multiple"))),
            category="Outlier",
            severity=severity,
            description=f"{bad_n} negative value(s) in column '{col}' (first: {float(first_bad[col]):.4f}). "
                        f"This column is documented as non-negative.",
            recommended_fix="Re-fetch from vendor. Sustained negatives suggest a sign-flip "
                            "in the export pipeline.",
        )