# Financial Data Quality Agent — Skill

A Claude Code Agent Skill that scans the `ai_agent_dataset/` for data
quality issues across five stock markets and reports each issue with
its severity, affected rows, and a recommended fix.

## What this does, in plain English

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
| `'--'` string in numeric columns | NASDAQ's eps_diluted and book_val_per_sh contain the literal string `'--'` instead of NaN. | Forces the column to non-numeric type; pandas operations like `.mean()` will raise. |
| Field completeness in wide format | Each HKEX symbol must have all six columns (Open/High/Low/Close/Vol/Turnover). | Missing columns silently break per-symbol analytics. |
| Lunch-break null partition (HKEX) | 12:30 rows are null *by design*. Nulls at any other time are vendor errors. | Tells the user which nulls to drop and which to investigate. |
| Duplicate timestamps | A wide-format daily file should have one row per Datetime. |
| `volume == price × shares` consistency | NASDAQ's description says `volume` is the dollar notional, equal to px_last × shares_traded. We verify it. | If a future export ships share count in the volume column instead, this check fires. |
| Date format (NYSE / TSE) | NYSE uses MM/DD/YYYY. TSE uses YYYY/MM/DD. NASDAQ uses ISO 8601. | Not corrupt data — but a footgun for cross-market joins. Some systems mis-parse MM/DD/YYYY as DD/MM/YYYY. |
| Look-ahead bias warning (NYSE) | Reminds the user to filter by `report_date`, not `fiscal_period_end`. | Backtests using filing-period-end pretend the user knew Q3 numbers on Sept 30, even though companies file weeks later. Looks good but isn't real. |
| Encoding mismatch (TSE) | The TSE description file is Shift-JIS while the data files are UTF-8. | Tools that auto-detect encoding from one file and reuse it on the other will fail. |
| Cross-market dual listing | BABA on NASDAQ and 9988.HK on HKEX are the same company. Their daily *returns* must correlate (~0.7-0.9). | If the correlation is low, one feed has wrong dates or wrong prices. Currently 0.977 — both feeds are consistent on this dimension. |

## Framework choice

**Claude Code Agent Skill** (`SKILL.md` + helper Python scripts).

Why:

1. **The brief recommended it first.** The assessment lists Claude Code
   Agent Skills as the first recommended approach.
2. **Workflow is the point.** A skill keeps the *workflow* (read
   descriptions → probe data → report) separate from the *tooling*
   (scripts that load HDF5/CSV). The grading rubric is process-focused —
   it wants to see how the agent decomposes the problem, not just a
   monolithic dump of issues. The SKILL.md makes that visible.
3. **No framework runtime cost.** Compared to LangGraph or the OpenAI
   Agents SDK, a Claude Code skill needs nothing beyond pandas / numpy /
   pytables. Easy to clone into another repo.
4. **Drop-in reusable.** A user in any other Claude Code project can
   copy this folder and the skill is ready to go.

## How to run

From `snom/dataset/`: 

```bash
python financial-data-quality/run.py
```

That's it. The orchestrator:

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

71 files scanned across 6 modules. **15 issues**: 1 critical, 8 warnings,
6 info. See `quality_report.md` in the working directory after running
`run.py`.

Highlights:

- **Critical**: 601318 (China Ping An) on 2025-11-20 has `close = 370.080`
  but `high = 37.317` — a 10× decimal-point error. The same root cause
  cascades into 4 separate detections (the OHLC violation, a +900% jump,
  a -90% reversion the next day, and a daily-vs-30min disagreement),
  which is exactly the kind of cross-validation that makes the bug hard
  to argue with.
- **Warning**: NASDAQ `eps_diluted` and `book_val_per_sh` ship as `'--'`
  string placeholders.
- **Warning**: HKEX `daily_prices.csv` has 2 rows sharing a Datetime.
- **Warning**: NYSE includes both `fiscal_period_end` and `report_date`
  — using the former introduces look-ahead bias.
- **Warning**: TSE description file and data files use different
  encodings (cp932 vs utf-8).
- **Info**: BABA / 9988.HK daily returns correlate at 0.977 — healthy.