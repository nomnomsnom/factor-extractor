"""
Shared types and helpers used by every per-market scanner.

  Issue                — a single data quality finding
  ScanResult           — one market's findings + metadata
  read_text_with_fallback / read_csv_with_fallback
                       — try a chain of encodings; return the bytes/df plus
                         the codec that worked. Used wherever vendor encoding
                         is uncertain (TSE description is cp932, TSE data is
                         utf-8 — so a single hardcoded codec is wrong).
"""

from __future__ import annotations
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional
import pandas as pd


SEVERITIES = ("critical", "warning", "info")
ENCODING_CHAIN = ("utf-8", "utf-8-sig", "cp932", "shift_jis", "gb18030")


@dataclass
class Issue:
    market: str
    document: str
    symbol: str
    date: str
    category: str
    severity: str
    description: str
    recommended_fix: str

    def __post_init__(self):
        if self.severity not in SEVERITIES:
            raise ValueError(f"invalid severity: {self.severity!r}")


@dataclass
class ScanResult:
    market: str
    issues: list[Issue] = field(default_factory=list)
    files_scanned: int = 0
    error: Optional[str] = None

    def add(self, **kwargs):
        self.issues.append(Issue(market=self.market, **kwargs))


def read_text_with_fallback(path: Path) -> tuple[str, str]:
    raw = Path(path).read_bytes()
    last_err = None
    for enc in ENCODING_CHAIN:
        try:
            return raw.decode(enc), enc
        except UnicodeDecodeError as e:
            last_err = e
    raise UnicodeDecodeError(
        f"none of {ENCODING_CHAIN} could decode {path}: {last_err}"
    )


def read_csv_with_fallback(path: Path, **kwargs) -> tuple[pd.DataFrame, str]:
    last_err = None
    for enc in ENCODING_CHAIN:
        try:
            return pd.read_csv(path, encoding=enc, **kwargs), enc
        except (UnicodeDecodeError, UnicodeError) as e:
            last_err = e
    raise UnicodeDecodeError(
        f"none of {ENCODING_CHAIN} could decode {path}: {last_err}"
    )


def issues_as_dicts(issues: list[Issue]) -> list[dict]:
    return [asdict(i) for i in issues]