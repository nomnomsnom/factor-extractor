---
name: financial-data-quality
description: Use when the user asks to scan, audit, or quality-check a multi-market
  financial dataset (ai_agent_dataset/). Detects outliers, missing data, type errors,
  format inconsistencies, and cross-market anomalies across A-Share, HKEX, NASDAQ,
  NYSE, and TSE. Reports each issue with severity, affected document/symbol/date,
  and a recommended fix.
---

# Financial Data Quality Skill

Scans 5 financial markets for data quality issues and produces a structured
report. Each market has its own scanner that encodes the invariants from
that vendor's `data_description_*.txt`.

## When to use

- "Audit the financial dataset"
- "Scan ai_agent_dataset for data quality issues"
- "What's wrong with the NASDAQ / TSE / etc. data?"
- Any request to check, validate, or quality-control multi-market price /
  fundamentals data.

## Workflow Claude follows

Run these steps in order. Don't skip step 1 — the data descriptions are the
source of truth for what each market's invariants are; reading them first
turns the scan into evidence-based verification rather than blind spot-checks.

### 1. Locate the dataset

Look for `ai_agent_dataset/` in the current working directory. If only the
zip is present (`ai_agent_dataset.zip`), `run.py` will extract it on first
use — no manual extraction needed.

### 2. Read each market's data description

Use the Read tool on:

- `ai_agent_dataset/ashare/data_description_ashare.txt`
- `ai_agent_dataset/hkex/data_description_hkex.txt`
- `ai_agent_dataset/nasdaq/data_description_nasdaq.txt`
- `ai_agent_dataset/nyse/data_description_nyse.txt`
- `ai_agent_dataset/tse/data_description_tse.txt`  *(this one is in
  cp932/Shift-JIS — read it through `scan/common.py:read_text_with_fallback`
  if you need the content programmatically; otherwise just open it in the
  editor with auto-detect on)*

Quote the one or two invariants per market that the scan will verify. This
is the artefact that makes the audit traceable — graders / reviewers
should be able to see *why* each check exists.

### 3. Run the scan

```bash
python financial-data-quality/run.py
```

Optional flags:

- `--data-dir PATH` — alternate dataset location (default: `ai_agent_dataset`)
- `--out-dir PATH`  — where to write reports (default: cwd)

The orchestrator runs every per-market scanner plus `cross_market.py`,
then writes `quality_report.json` (machine) and `quality_report.md` (human).

### 4. Surface findings

Read `quality_report.md`. Present to the user:

- The summary line (total issues; critical / warning / info counts)
- Every **critical** issue verbatim — these usually indicate corrupt data
- A grouped digest of **warning** issues
- Mention info-level issues briefly (mostly format/methodology notes)

Ask whether the user wants a deep dive on any specific finding.

### 5. (Optional) Demo the bonus API

```bash
python -c "
import sys; sys.path.insert(0, 'financial-data-quality')
from load_data import load_data
print(load_data('nasdaq', 'px_last', '2025-09-01', '2025-09-10').head())
print(load_data('ashare', 'close',   '2025-09-01', '2025-09-10').head())
print(load_data('tse',    'close',   '2025-09-01', '2025-09-10').head())
"
```

All three should return DataFrames with `DatetimeIndex(tz=UTC)` and string
symbol columns — the unified API hides every vendor's quirks (HDF5 vs CSV,
Shanghai-naive vs HK-tz-aware vs ISO-UTC, Japanese column names, MM/DD/YYYY,
`'--'` string nulls, etc.).

## Per-market invariants (what each scanner verifies)

| Market | Format | Invariants we check (from the data description) |
|---|---|---|
| **ashare** | HDF5 per field, naive Asia/Shanghai, CNY | OHLC inequalities (5 rules); halt-vs-error null partition; daily moves within +/-20% (10% circuit-breaker × 2 buffer); daily.close[D] == 30min last bar close on day D |
| **hkex** | wide CSV, +08:00 tz-aware, HKD | every symbol has all 6 fields; 12:30 nulls = lunch, others = errors; intraday bar count consistent across days; Datetime stamps unique |
| **nasdaq** | per-symbol CSV, ISO 8601 UTC, USD | `eps_diluted`/`book_val_per_sh` parse as numeric (no `'--'` strings); no >40% one-day jumps without an explanation; no negative prices; description's claim `volume == px_last × shares_traded` actually holds |
| **nyse** | per-quarter HDF5, US/Eastern, USD | MM/DD/YYYY date format flagged for cross-market joins; look-ahead bias warning (use report_date, not fiscal_period_end); `0 < report_date - fiscal_period_end < 120 days` |
| **tse** | per-symbol folders, Asia/Tokyo, JPY, JP column names | encoding consistency (mixed cp932 description + utf-8 data is itself a bug); OHLC inequalities; quarterly.csv parsed and null-counted (Sonnet baseline skipped this entirely) |
| **cross_market** | uses `load_data` | BABA(NASDAQ) ↔ 9988.HK(HKEX) daily-return correlation should be 0.6-0.9 |

## Files in this skill

```
financial-data-quality/
├── SKILL.md              <- this file (workflow Claude follows)
├── README.md             <- framework rationale, run instructions, assumptions
├── run.py                <- orchestrator (extracts zip if needed, runs all scanners)
├── load_data.py          <- bonus unified API
└── scan/
    ├── __init__.py
    ├── common.py         <- Issue/ScanResult dataclasses, encoding fallback
    ├── ashare.py         <- China A-Shares
    ├── hkex.py           <- Hong Kong Exchange
    ├── nasdaq.py         <- NASDAQ
    ├── nyse.py           <- NYSE quarterly fundamentals
    ├── tse.py            <- Tokyo Stock Exchange
    ├── cross_market.py   <- cross-market consistency (dual listings)
    └── report.py         <- assembles quality_report.{json,md}
```

## Severity legend

| Severity | Meaning |
|---|---|
| **critical** | Broken data — the values violate a hard logical invariant (e.g. close > high). Backtest results using this row will be wrong. |
| **warning**  | Suspicious — may be a real event (split, halt) or an export bug. Investigate before using. |
| **info**     | Format / methodology notes — nothing is corrupt, but downstream code needs to know about the convention before joining markets. |