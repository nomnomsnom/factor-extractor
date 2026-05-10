"""Tests for scan/generic.py — the tier-1/2/3 helpers shared by every market.

Run from the skill folder:
    pytest tests/

Goals:
  - Each helper fires when its invariant is violated.
  - Each helper is silent when the data is clean.
  - The `suppress_columns` de-dup mechanism actually suppresses (this is
    what stops a market-specific check and the generic check from
    double-flagging the same row).
  - One property-based test (hypothesis) on check_no_negative as a worked
    example. Property-based tests catch edge cases (empty list, NaN, +inf,
    all-zero) you'd never write by hand.
"""

from __future__ import annotations

import pandas as pd
import pytest
from hypothesis import given, strategies as st

from scan.common import ScanResult
from scan import generic


def _result() -> ScanResult:
    return ScanResult(market="test")


# --- Tier 1: schema -------------------------------------------------------

def test_check_columns_flags_missing():
    df = pd.DataFrame({"a": [1, 2], "b": [3, 4]})
    r = _result()
    generic.check_columns(r, df, document="t.csv", expected=["a", "b", "c"])
    assert len(r.issues) == 1
    issue = r.issues[0]
    assert issue.severity == "warning"
    assert issue.category == "Schema"
    assert "c" in issue.description


def test_check_columns_silent_when_complete():
    df = pd.DataFrame({"a": [1], "b": [2]})
    r = _result()
    generic.check_columns(r, df, document="t.csv", expected=["a", "b"])
    assert r.issues == []


def test_check_columns_flags_extras_when_requested():
    """flag_extras is opt-in — only fires when the caller asks for it."""
    df = pd.DataFrame({"a": [1], "b": [2], "surprise": [3]})
    r = _result()
    generic.check_columns(r, df, document="t.csv", expected=["a", "b"],
                          flag_extras=True)
    assert len(r.issues) == 1
    assert r.issues[0].severity == "info"
    assert "surprise" in r.issues[0].description


# --- Tier 2: completeness -------------------------------------------------

def test_check_no_duplicate_keys_fires_on_dup():
    df = pd.DataFrame({"Datetime": ["2025-01-01", "2025-01-02", "2025-01-01"]})
    r = _result()
    generic.check_no_duplicate_keys(r, df, document="t.csv",
                                    key_columns=["Datetime"])
    assert len(r.issues) == 1
    assert "duplicate keys" in r.issues[0].description


def test_check_no_duplicate_keys_silent_on_unique():
    df = pd.DataFrame({"Datetime": ["2025-01-01", "2025-01-02"]})
    r = _result()
    generic.check_no_duplicate_keys(r, df, document="t.csv",
                                    key_columns=["Datetime"])
    assert r.issues == []


# --- Tier 3: validity -----------------------------------------------------

def test_check_no_negative_fires_on_negative():
    df = pd.DataFrame({"price": [10.0, -5.0, 20.0], "date": ["a", "b", "c"]})
    r = _result()
    generic.check_no_negative(r, df, document="t.csv", positive_columns=["price"])
    assert len(r.issues) == 1
    assert r.issues[0].severity == "critical"
    assert "negative" in r.issues[0].description.lower()


def test_check_no_negative_silent_on_clean():
    df = pd.DataFrame({"price": [10.0, 5.0, 20.0]})
    r = _result()
    generic.check_no_negative(r, df, document="t.csv", positive_columns=["price"])
    assert r.issues == []


def test_check_numeric_columns_suppress_works():
    """`suppress_columns` is the de-dup mechanism: a market scanner with its
    own '--' string detector should be able to silence the generic dtype
    check on the same column. If this test ever breaks, the entire de-dup
    contract between bespoke and generic checks is broken."""
    df = pd.DataFrame({"eps_diluted": ["--", "--", "--"]})

    # Without suppress: the column is non-numeric → generic check fires.
    r = _result()
    generic.check_numeric_columns(r, df, document="t.csv",
                                  numeric_columns=["eps_diluted"])
    assert len(r.issues) == 1, "generic dtype check should fire on non-numeric column"

    # With suppress: same input, no issue.
    r2 = _result()
    generic.check_numeric_columns(r2, df, document="t.csv",
                                  numeric_columns=["eps_diluted"],
                                  suppress_columns={"eps_diluted"})
    assert r2.issues == [], "suppress_columns must silence the generic check"


# --- Property-based -------------------------------------------------------

@given(st.lists(st.floats(min_value=-1000, max_value=1000, allow_nan=False),
                min_size=1, max_size=50))
def test_no_negative_invariant(values):
    """For ANY list of floats, check_no_negative must fire iff at least
    one value is < 0. Hypothesis will generate hundreds of inputs; if any
    breaks the invariant it shrinks the failing case to the smallest
    example and reports it."""
    df = pd.DataFrame({"price": values})
    r = _result()
    generic.check_no_negative(r, df, document="t.csv", positive_columns=["price"])

    has_negative = any(v < 0 for v in values)
    fired = len(r.issues) > 0
    assert has_negative == fired
