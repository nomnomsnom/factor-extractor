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

### General checks (run on every market)

These are the same three tiers applied uniformly to every market, so the
audit is systematic rather than ad-hoc. They live in `scan/generic.py` and
each market scanner calls them with a small manifest describing what it
expects. Where a market has a more specific check covering the same
underlying problem (e.g. NASDAQ's `'--'` string detector), the generic
check passes `suppress_columns=...` so the same row is never flagged twice.

| Tier | Check | What it looks for | Why it matters |
|---|---|---|---|
| 1 (schema) | File presence | Every file the data description promises must exist on disk. | Missing files crash downstream loaders silently if the code uses defaults. |
| 1 (schema) | Column presence | Each table must have its documented column set. | Silent renames break downstream analytics. |
| 2 (completeness) | Per-column null rate | Any column with ≥5% nulls. | Surfaces hidden gaps that get masked by `.dropna()`. |
| 2 (completeness) | Duplicate keys | One row per natural key (e.g. one row per Datetime, one row per (ticker, fiscal_period_end)). | Double-counted rows skew aggregates, joins explode in size. |
| 3 (validity) | Numeric dtype | Columns documented as numeric must parse as numeric. | Sentinel strings (`'--'`, `'suspended'`) silently force dtype=object and break `.mean()` / `.pct_change()`. |
| 3 (validity) | Non-negative | Prices, volumes, turnover must be ≥ 0. | Caught NVDA's negative volume / shares_traded — almost certainly a sign-flip in the export pipeline. |

### Market-specific checks

Each market also has bespoke checks tailored to its format quirks and
vendor description:

| Check | Market | What it looks for | Why it matters |
|---|---|---|---|
| OHLC inequality | ashare, tse | close above high, low above high, open above high, close below low, open below low. | If close > high, the row is broken. Any analytics built on it is wrong. |
| Halt vs partial null | ashare | Rows where ALL OHLC fields are null on the same day vs rows where only some are. | All-null = legitimate trading suspension. Partial-null = vendor export bug. |
| Extreme one-day move | ashare (>20%), nasdaq (>40%) | Single-day pct change exceeding the threshold. | China caps daily moves at ±10%, so 20%+ implies decimal error or post-halt resumption. NASDAQ 40%+ usually means an unadjusted split. |
| Daily ↔ 30-min consistency | ashare | Last 30-min bar's close on day D must match daily.close[D]. | A-share ships the same prices in two formats. Disagreement means one feed is corrupt. |
| Symbol-code dtype | ashare | Every field file must have the same column dtype. `daily/turnover.h5` is int64; the rest are str. | `'000333'` becomes `333`. Joins between turnover and other fields silently mis-align. |
| Sentinel strings in numeric columns | ashare (30-min), nasdaq | Non-numeric strings lurking in numeric columns (`'suspended'`, `'--'`). | Forces dtype to object; numeric ops raise. |
| Field completeness in wide format | hkex | Each symbol must have all six fields (Open/High/Low/Close/Vol/Turnover). | Missing columns silently break per-symbol analytics. |
| Lunch-break null partition | hkex | 12:30 nulls expected; nulls at other times are vendor errors. | Tells the user which nulls to drop and which to investigate. |
| Bar count per day | hkex | Each trading day should produce the same intraday bar count. | Short days suggest feed dropouts. |
| Trading-hours window | hkex | Timestamps must fall inside 09:30-16:00. | Timezone or bar-edge convention bugs. |
| Calendar gap per ticker | nasdaq | A gap of more than 4 calendar days between adjacent rows. | TSLA has a 10-day gap (2025-12-12 → 2025-12-22), about 5 missing trading days. |
| `volume == price × shares` consistency | nasdaq | Description says volume is dollar notional, equal to px_last × shares_traded. We verify it. | If a future export ships share count in the volume column, this check fires. |
| Date format note | nasdaq, nyse, tse | NYSE uses MM/DD/YYYY. TSE uses YYYY/MM/DD. NASDAQ uses ISO 8601. | Not corrupt data — but a footgun for cross-market joins. |
| Look-ahead bias warning | nyse | Reminds the user to filter by `report_date`, not `fiscal_period_end`. | Backtests using filing-period-end pretend the user knew Q3 numbers on Sept 30. |
| Snapshot coverage | nyse | Each .h5 should carry overlapping history so users can audit restatements. | This dataset's snapshots don't overlap; flagged so the user knows they can't verify point-in-time stability. |
| `tz_offset` matches DST regime | nyse | -04:00 (EDT) inside DST window; -05:00 (EST) outside. | Q3 has rows in December stamped -04:00 (should be -05:00); Q4 has rows in March 2026 stamped -05:00 (should be -04:00). Off by 1 hour. |
| Report-date lag | nyse | report_date must be after fiscal_period_end by 0-120 days. | Negative lag means filing predated the period end; >120 days suggests a delinquent filer or vendor error. |
| Encoding mismatch | tse | Description file is Shift-JIS while the data files are UTF-8. | Tools that auto-detect encoding from one file and reuse it on the other will fail. |
| Cross-market dual listing | cross | BABA/9988.HK and 601318/2318.HK are dual-listed. Daily *returns* must correlate (~0.6-0.9). | If correlation is low or one specific day diverges, a feed is wrong. The 601318/2318.HK pair independently confirms the ashare decimal error on 2025-11-20. |

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
pip install -r financial-data-quality/requirements.txt
python financial-data-quality/run.py
```

To run the unit tests (optional):

```bash
pip install -r financial-data-quality/requirements-dev.txt
cd financial-data-quality && pytest tests/ -v
```

The test suite covers `scan/generic.py` (the tier-1/2/3 helpers shared
across every market) with deterministic cases plus one property-based
test using `hypothesis`. The property test asserts an invariant
(`check_no_negative` fires iff a negative value is present in the
input) and lets hypothesis generate hundreds of inputs trying to break
it — much higher bug-finding power per line of test code than
hand-written examples.

The orchestrator:

1. Extracts `ai_agent_dataset.zip` if the folder isn't already present.
2. Runs every per-market scanner and the cross-market scanner.
3. Writes `quality_report.json` and `quality_report.md` to the current
   directory (or `--out-dir`).

The scan itself takes a few seconds.

### Report layout

`quality_report.md` is structured to be skim-first, then dig:

1. **Summary** — total counts by severity.
2. **Issues by category** — crosstab of category × severity so the reviewer
   can see at a glance whether the dataset is dominated by outliers, missing
   data, type errors, etc.
3. **Cascading findings** — issues that share `(symbol, date)`. Two or more
   independent checks firing on the same row is almost always one root-cause
   bug cross-validated by multiple detectors. The 601318 (Ping An) decimal
   error fires under Outlier (close > high), Extreme Move (+900%), and
   Cross-Market Inconsistency (vs 2318.HK) — surfaced as a single group so
   the reviewer doesn't mistake one bug for three.
4. **Per-severity sections** — every issue verbatim, grouped Critical →
   Warning → Info, each with `symbol`, `date`, `document`, description,
   recommended fix.

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
  for HDF5 reading) is available. See `requirements.txt`.
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
├── requirements.txt      pip-installable dependencies (runtime)
├── requirements-dev.txt  pip-installable dependencies (testing)
├── run.py                orchestrator
├── load_data.py          bonus unified API
├── tests/
│   ├── conftest.py       sys.path setup so `import scan.*` works
│   └── test_generic.py   pytest + hypothesis cases for scan/generic.py
└── scan/
    ├── __init__.py
    ├── common.py         Issue/ScanResult dataclasses, encoding fallback helpers
    ├── generic.py        Tier 1/2/3 checks every market reuses
    ├── ashare.py         China A-Shares scanner
    ├── hkex.py           Hong Kong Exchange scanner
    ├── nasdaq.py         NASDAQ scanner
    ├── nyse.py           NYSE fundamentals scanner
    ├── tse.py            Tokyo Stock Exchange scanner
    ├── cross_market.py   dual-listing checks
    └── report.py         JSON + Markdown report emitter
```

## What the scanner found on this dataset (sample run)

77 files scanned across 6 modules. **24 issues**: 4 critical, 14 warnings,
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
- **Critical**: NVDA on 2025-10-15 has negative `volume` and `shares_traded`.
  Caught by the generic non-negative tier-3 check — almost certainly a
  sign-flip in the export pipeline.
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