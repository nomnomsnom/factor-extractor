# Financial Data Quality Agent — Skill

A Claude Code Agent Skill that scans the `ai_agent_dataset/` for data
quality issues across five stock markets and reports each issue with
its severity, affected rows, and a recommended fix.

## What this does

The dataset has six months of stock-market data from five exchanges, each
delivered by a different vendor with different files, formats, encodings,
and column names. Real production data has bugs — typos, off-by-one
encodings, decimal-point errors, mislabelled columns. This agent finds
those bugs automatically.

**Each scanner targets one market and runs specific checks:**

| Check | What it actually looks for | Why it matters |
|---|---|---|
| OHLC inequality | Rows where the price relationships are impossible — close above high, low above high, etc. | If close > high, the data row is broken. Any analytics built on it will be wrong. |
| Halt vs partial null | Rows where ALL OHLC fields are null on the same day for the same stock vs. rows where only some fields are null. | All-null = the stock was suspended (legitimate). Partial-null = the vendor's export pipeline dropped data (a bug). |
| Extreme one-day move | A-share daily change above 20%, NASDAQ above 40%. | China caps daily moves at ±10%, so 20%+ implies post-halt resumption, a rights issue, or a decimal-point error. NASDAQ 40%+ usually means an unadjusted stock split. |
| Daily ↔ 30-min consistency | The last 30-min bar's close on day D should match the daily-file close[D]. | A-share ships the same prices in two formats. They should agree; if they don't, one feed is corrupt. |
| Schema (column-dtype consistency) | Every A-share field file must have the same column dtype (str). `daily/turnover.h5` is int64. | `'000333'` becomes `333`. Joins between turnover and other fields silently mis-align. |
| Sentinel strings in numeric 30-min columns | Any non-numeric string lurking in a column that should be numeric (e.g. `'suspended'`). | Forces dtype to non-numeric; numeric ops raise. |
| `'--'` string in numeric columns | NASDAQ's eps_diluted and book_val_per_sh contain the literal string `'--'` instead of NaN. | Same problem class — non-numeric dtype breaks `.mean()` and friends. |
| Field completeness in wide format | Each HKEX symbol must have all six columns (Open/High/Low/Close/Vol/Turnover). | Missing columns silently break per-symbol analytics. |
| Lunch-break null partition (HKEX) | 12:30 rows are null *by design*. Nulls at any other time are vendor errors. | Tells the user which nulls to drop and which to investigate. |
| Duplicate timestamps | A wide-format daily file should have one row per Datetime; a per-symbol file should have one row per date. | Found 2 duplicate rows in HKEX `daily_prices.csv` and a duplicate trading day in TSE 9984. |
| Calendar gap per ticker (NASDAQ) | A gap of more than 4 calendar days between adjacent rows means missing trading days. | TSLA has a 10-day gap (2025-12-12 → 2025-12-22), about 5 missing trading days. |
| `volume == price × shares` consistency | NASDAQ's description says `volume` is the dollar notional, equal to px_last × shares_traded. We verify it. | If a future export ships share count in the volume column instead, this check fires. |
| Date format (NYSE / TSE) | NYSE uses MM/DD/YYYY. TSE uses YYYY/MM/DD. NASDAQ uses ISO 8601. | Not corrupt data — but a footgun for cross-market joins. Some systems mis-parse MM/DD/YYYY as DD/MM/YYYY. |
| Look-ahead bias warning (NYSE) | Reminds the user to filter by `report_date`, not `fiscal_period_end`. | Backtests using filing-period-end pretend the user knew Q3 numbers on Sept 30, even though companies file weeks later. Looks good but isn't real. |
| Timezone matches DST regime (NYSE) | `tz_offset` should agree with the DST regime of `update_timestamp` (-04:00 inside DST, -05:00 outside). | Q3 has rows in December stamped -04:00 (should be -05:00). Q4 has rows in March 2026 stamped -05:00 (should be -04:00). Off by 1 hour when converted to UTC. |
| Encoding mismatch (TSE) | The TSE description file is Shift-JIS while the data files are UTF-8. | Tools that auto-detect encoding from one file and reuse it on the other will fail. |
| Cross-market dual listing | BABA/9988.HK and 601318/2318.HK are dual-listed. Their daily *returns* must correlate (~0.6-0.9). | If the correlation is low or one specific day diverges, a feed is wrong. The 601318/2318.HK pair independently confirms the ashare decimal error on 2025-11-20. |

## Framework choice

**Claude Code Agent Skill** (`SKILL.md` + helper Python scripts).

- Workflow lives in `SKILL.md` (markdown), tooling lives in `scan/`
  (Python). Edit one without touching the other.
- No agent loop, no graph executor, no LLM calls in the scanner. Just
  `pandas` + `tables`.
- Self-contained folder. Drop into `.claude/skills/`, or lift `scan/`
  out into any other Python project.
- Markdown-only entry point. Readable without learning a framework.
- Add a check = one module in `scan/` + one bullet in `SKILL.md`. No
  API surface, no version pinning, no redeploy.

## How to run

> Note: `snom/dataset/` is my own personal working directory — it's where I
> placed the `ai_agent_dataset.zip`. The skill itself is
> location-agnostic: run it from any directory that contains either an
> `ai_agent_dataset/` folder or `ai_agent_dataset.zip` next to the
> `financial-data-quality/` folder.

From `snom/dataset/`:

```bash
python financial-data-quality/run.py
```

The orchestrator:

1. Extracts `ai_agent_dataset.zip` if the folder isn't already present.
2. Runs every per-market scanner and the cross-market scanner.
3. Writes `quality_report.json` and `quality_report.md` to the current
   directory (or `--out-dir`).

The scan itself takes a few seconds.

### Bonus: query data through the unified API

```python
import sys
sys.path.insert(0, "financial-data-quality")
from load_data import load_data

# Same shape comes back from every market:
load_data("nasdaq", "px_last", "2025-09-01", "2025-09-10")  # rows = dates UTC, cols = tickers
load_data("ashare", "close",   "2025-09-01", "2025-09-10")
load_data("tse",    "close",   "2025-09-01", "2025-09-10")
load_data("hkex",   "close",   "2025-09-01", "2025-09-10")
load_data("nyse",   "revenue", "2025-09-01", "2026-03-02")
```

The function hides every vendor's quirks: HDF5 vs CSV, Shanghai-naive vs
HK-tz-aware vs ISO-UTC, Japanese column names, MM/DD/YYYY, `'--'` string
nulls.

### Using as a Claude Code skill

If you put this folder where Claude Code looks for skills (per the docs:
either in `~/.claude/skills/financial-data-quality/` or in a project's
`.claude/skills/`), you can invoke it by simply asking:

> *"Audit the financial dataset for quality issues."*

Claude will follow the workflow in `SKILL.md` step-by-step.

## Assumptions made

- The dataset folder is named `ai_agent_dataset/` and lives next to (or
  is auto-extracted from) `ai_agent_dataset.zip` in the working directory.
- A Python 3.11+ environment with `pandas`, `numpy`, `tables` (PyTables
  for HDF5 reading) is available.
- Severity thresholds (40% for NASDAQ splits, 20% for A-share extreme
  moves, 5% for volume/notional disagreement, 0.3/0.5 for cross-listing
  correlation) are reasonable defaults but can be tuned in the per-market
  scanner files if your domain conventions differ.
- "Cross-market" currently means BABA ↔ 9988.HK. Adding more dual
  listings is a trivial extension in `scan/cross_market.py`.
- We do **not** apply any fixes — the skill only reports them. 

## Repo layout

```
financial-data-quality/
├── SKILL.md              workflow Claude follows when invoked
├── README.md             this file
├── run.py                orchestrator
├── load_data.py          bonus unified API
└── scan/
    ├── __init__.py
    ├── common.py         Issue/ScanResult dataclasses, encoding fallback helpers
    ├── ashare.py         China A-Shares scanner
    ├── hkex.py           Hong Kong Exchange scanner
    ├── nasdaq.py         NASDAQ scanner
    ├── nyse.py           NYSE fundamentals scanner
    ├── tse.py            Tokyo Stock Exchange scanner
    ├── cross_market.py   dual-listing checks
    └── report.py         JSON + Markdown report emitter
```

## What the scanner found on this dataset (sample run)

77 files scanned across 6 modules. **22 issues**: 2 critical, 14 warnings,
6 info. See `quality_report.md` in the working directory after running
`run.py`.

Highlights:

- **Critical**: 601318 (China Ping An) on 2025-11-20 has `close = 370.080`
  but `high = 37.317` — a 10× decimal-point error. The same root cause
  cascades into 5 independent detections: OHLC violation, +900% extreme
  move, -90% reversion the next day, daily-vs-30min disagreement, and a
  cross-market disagreement with 2318.HK (which is unaffected). The
  cross-validation makes the bug undeniable and pinpoints the daily file
  as the corrupt one.
- **Critical**: A-share `daily/turnover.h5` has int64 column codes while
  every other field file uses str — silently strips leading zeros from
  symbol codes (e.g. `'000333'` → `333`).
- **Warning**: A-share `30min/volume.h5` contains the literal string
  `'suspended'` mixed into numeric data for symbol 000001.
- **Warning**: NASDAQ TSLA has roughly 5 missing trading days
  (2025-12-12 → 2025-12-22 gap).
- **Warning**: NYSE Q3 has rows updated in December stamped `-04:00`
  when DST has ended (should be `-05:00`); Q4 has rows updated in March
  2026 stamped `-05:00` when DST has restarted (should be `-04:00`).
- **Warning**: NASDAQ `eps_diluted` and `book_val_per_sh` ship as `'--'`
  string placeholders.
- **Warning**: HKEX `daily_prices.csv` has 2 rows sharing a Datetime;
  TSE 9984 has a duplicate trading day.
- **Warning**: TSE description file and data files use different
  encodings (cp932 vs utf-8).
- **Info**: BABA / 9988.HK daily returns correlate at 0.977 — healthy.