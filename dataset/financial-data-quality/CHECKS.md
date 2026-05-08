# What each scanner checks 

Every check on every market, with a real example from running this agent
on the dataset. If a row says "FOUND in this dataset", the actual scan run
flagged it. "NOT FOUND" means the check exists for safety but didn't fire
on this particular run.

---

## ASHARE — China A-Shares (Shanghai + Shenzhen)

Format: HDF5 files, one per field (open, high, low, close, volume, turnover).
Daily and 30-minute frequencies. Prices in CNY (Chinese yuan).

### Check 1 — OHLC inequalities (5 rules)

A trading day's prices must obey these rules:
- close ≤ high
- close ≥ low
- open ≤ high
- open ≥ low
- low ≤ high

If any of these fails, the row is impossible and the data is corrupt.

**FOUND in this dataset (1 violation):**
- Stock 601318 (Ping An Insurance) on 2025-11-20:
  close = 370.080, high = 37.317
- Close is 9.92× higher than high → classic decimal-point error.
- Recommended fix: divide close by 10 → 37.008. Re-fetch from WindQuant.

### Check 2 — Halt vs error null partition

Missing data falls into two categories:
- **All OHLC fields null on the same day** = trading halt/suspension (legitimate)
- **Some fields null, others not** = vendor pipeline bug

We split them so the user knows what to drop and what to investigate.

**FOUND in this dataset:**
- 5 rows where all OHLC fields are null on the same date → halts.
- Recommended: keep with a "halt" flag, don't forward-fill.

### Check 3 — Extreme single-day move (>20%)

Chinese A-shares have a 10% daily price-change limit ("circuit breaker").
A move above 20% is either a special event (post-halt resumption, rights
issue) or a data error.

**FOUND in this dataset (2):**
- 601318 on 2025-11-20: +900% (caused by the corrupted close above)
- 601318 on 2025-11-21: -90% (the bad value reverting next day)
- Both are downstream effects of the same root cause as check 1.

### Check 4 — Daily ↔ 30-min consistency

A-share data ships in two forms: daily summaries AND every 30-minute bar.
For day D:
- Last 30-min bar close on day D should equal daily.close[D]

If they disagree, one of the two feeds is wrong.

**FOUND in this dataset (1):**
- 601318 on 2025-11-20: daily file says 370.08, 30-min file says ~37.
- This pinpoints which feed is corrupt: the **daily** file is wrong, the
  30-min file is right.

### Check 5 — Schema (column-dtype consistency across field files)

Every field file (open/high/low/close/volume/turnover) should have the
same column dtype, otherwise leading zeros in symbol codes get silently
truncated to integers.

**FOUND in this dataset:**
- `daily/turnover.h5` has columns as **int64**; every other file has
  columns as **str**.
- So `'000858'` becomes `858` in turnover but stays `'000858'` everywhere
  else. Joins between turnover and other fields will silently mis-align
  on the 5+ symbols whose codes start with leading zeros.
- Recommended fix: re-export with explicit string symbol codes, or coerce
  on read with `df.columns = df.columns.astype(str).str.zfill(6)`.

### Check 6 — Sentinel strings in numeric 30-min columns

Any non-numeric string lurking in a column that should be numeric (e.g.
the literal word `'suspended'`).

**FOUND in this dataset:**
- `30min/volume.h5` contains the string `'suspended'` in 8 cells of
  symbol `000001`'s column. Likely placed there to mark halted bars.
- The column dtype is therefore non-numeric — `df['000001'].mean()` raises.
- Recommended fix: `df = df.apply(pd.to_numeric, errors='coerce')` on read.
  Decide whether 'suspended' rows should be NaN or carry a separate
  halt-indicator column.

---

## HKEX — Hong Kong Stock Exchange

Format: two wide-format CSVs (`daily_prices.csv`, `intraday_30min.csv`).
Columns named like `0700.HK_Open`, `9988.HK_Close`. Prices in HKD.

### Check 1 — Field completeness per symbol

Every symbol should have all 6 fields: Open, High, Low, Close, Vol, Turnover.

**NOT FOUND.** All 20 HKEX symbols have all 6 fields.

### Check 2 — Duplicate timestamps

A wide-format daily file should have exactly one row per Datetime.

**FOUND in this dataset:**
- `daily_prices.csv` has 122 rows but only 121 unique Datetimes.
  → 2 rows share a Datetime, which means one row was duplicated.
- Recommended fix: `df.drop_duplicates(subset='Datetime')` and investigate
  the vendor's incremental-refresh pipeline.

### Check 3 — Lunch-break null partition (12:30 vs other times)

HKEX trades 09:30-12:00 and 13:00-16:00. The 12:30 bar is null **by
design** (documented). Nulls at any other time are vendor errors.

**FOUND in this dataset:**
- 2,420 nulls at 12:30 across 20 symbols × 121 days × 1 bar/day = expected.
- 0 nulls at other times → no errors.
- Severity is **info** because this is the documented behaviour.

### Check 4 — Intraday bar count per day

Every trading day should produce the same number of intraday bars.

**NOT FOUND.** All days have 12 bars (consistent with HKEX trading
hours and the bar-edge convention).

### Check 5 — Trading-hours window

Intraday timestamps must fall within 09:30-16:00 HKT.

**NOT FOUND.** All timestamps are within hours.

### Check 6 — Timezone offset present

Description says timestamps include `+08:00` offset. Verify.

**NOT FOUND.** The `+08:00` offset is present.

---

## NASDAQ — US technology stocks

Format: one CSV per ticker (AAPL.csv, GOOGL.csv, ...). ISO 8601 UTC dates.
Prices in USD.

### Check 1 — `'--'` string in numeric columns

NASDAQ's `eps_diluted` and `book_val_per_sh` are supposed to be numbers,
but the vendor uses the literal string `'--'` instead of NaN when the
quarter hasn't reported yet. This forces the column to non-numeric type
and breaks operations like `.mean()`.

**FOUND in this dataset:**
- AAPL has 122 rows of `'--'` in `eps_diluted` and 122 in `book_val_per_sh`.
  Same pattern across all 20 NASDAQ files.
- Recommended fix: `df[col] = pd.to_numeric(df[col], errors='coerce')`.

### Check 2 — Big single-day price jumps (>40%)

A 40%+ move in a stock with no news is almost certainly an unadjusted
stock split.

**FOUND in this dataset:**
- GOOGL on 2025-11-03: $329.90 → $158.49 (-52% drop in one day).
- Looks exactly like a 2-for-1 split that wasn't backward-adjusted.
- Recommended fix: apply a 0.4804 backward adjustment factor to all
  pre-split prices, or re-fetch with split adjustment enabled.

### Check 3 — Negative prices

Equity prices cannot be negative.

**NOT FOUND.** No negative prices anywhere.

### Check 4 — `volume == px_last × shares_traded` consistency

The data description says NASDAQ's `volume` field is dollar-notional
(price × shares), NOT a share count. We verify this is actually true.

**NOT FOUND.** The relationship holds exactly (median ratio = 1.0). This
means the description is accurate. If a future export ever ships share
count in the volume column, this check will fire.

### Check 5 — Date format ISO 8601 UTC

Description says dates are ISO 8601 UTC. Verify the `Z` or `+00:00` suffix.

**NOT FOUND.** Dates look like `2025-09-02T00:00:00Z` — correct.

### Check 6 — Calendar gaps per ticker

A gap of more than 4 calendar days between adjacent rows means we lost
at least one trading day (Fri→Mon is 3 days, Fri→Tue is 4; longer means
a missing weekday).

**FOUND in this dataset:**
- TSLA has only 119 rows (every other ticker has 124). One gap of 10
  calendar days between 2025-12-12 and 2025-12-22 — that's roughly 5
  missing trading days.
- Recommended fix: cross-check the NASDAQ trading calendar (no scheduled
  early-close gaps in this period). Likely a vendor feed outage. Re-fetch
  from BQuant.

---

## NYSE — Quarterly fundamentals (NOT prices)

Format: HDF5 files per fiscal quarter end (3 files). MM/DD/YYYY dates.
US/Eastern timestamps. USD values. Each file is a "snapshot" of company
financials at that quarter-end.

### Check 1 — Date format MM/DD/YYYY

The dates themselves are valid, but the format is inconsistent with
other markets (NASDAQ uses ISO, TSE uses YYYY/MM/DD).

**FOUND in this dataset (info severity):**
- `06/30/2025` style format flagged.
- Why it matters: when joining with NASDAQ data, MM/DD/YYYY can be
  silently mis-parsed as DD/MM/YYYY on systems with a different locale.
- Recommended fix: `pd.to_datetime(col, format='%m/%d/%Y')`.

### Check 2 — Look-ahead bias warning

NYSE provides both `fiscal_period_end` (when the quarter ended) and
`report_date` (when the company filed). Using the former for backtests
introduces look-ahead bias — companies file weeks/months after quarter end.

**FOUND in this dataset (warning):**
- Methodology warning fires regardless of data values.
- Example: AAPL Q2 2025 has fiscal_period_end = 06/30/2025 but
  report_date = ~08/15/2025. A backtest using 06/30 pretends the user
  knew Q2 numbers on June 30 — but they wouldn't have until August.
- Recommended fix: always filter by report_date, never by fiscal_period_end.

### Check 3 — Snapshot coverage observation

In production, snapshots usually carry overlapping history (each new
snapshot includes all prior quarters), so users can detect when a vendor
restates a company's numbers (e.g. AAPL's Q2 revenue changing from
$90B in the June snapshot to $92B in the December snapshot).

**FOUND in this dataset (info):**
- Each snapshot file contains ONLY its own quarter — no overlap across
  the 3 files.
- This means we can't detect point-in-time drift even if it existed.
- Recommended fix: ask FactQuant to emit cumulative snapshots.

### Check 4 — Timezone offset matches DST regime

`tz_offset` should agree with the DST regime of `update_timestamp`. US
Daylight Saving Time runs from the second Sunday of March to the first
Sunday of November. Inside DST: -04:00 (EDT). Outside: -05:00 (EST).

**FOUND in this dataset:**
- Q3 snapshot (`2025-09-30.h5`) has rows with `update_timestamp = 12/15/2025`
  stamped `-04:00`. DST ended 2025-11-02 — should be `-05:00`. Off by 1 hour.
- Q4 snapshot (`2025-12-31.h5`) has rows with `update_timestamp` in
  March 2026 (post DST start 2026-03-08) still stamped `-05:00` — should
  be `-04:00`.
- Recommended fix: re-derive `tz_offset` from the timestamp, or convert to
  UTC by parsing with `America/New_York` and letting pandas pick the
  correct offset automatically.

### Check 5 — Report-date lag sanity

`report_date` should be after `fiscal_period_end` and within ~120 days.

**NOT FOUND.** All filing lags are within range.

---

## TSE — Tokyo Stock Exchange

Format: one folder per stock code (e.g. `7203/`, `9984/`), each with
`daily.csv` and `quarterly.csv`. Japanese column names (日付 = date,
始値 = open, etc). Dates YYYY/MM/DD. Prices in JPY (whole yen).

### Check 1 — Encoding consistency within market

Files in the same market should use the same text encoding.

**FOUND in this dataset:**
- `data_description_tse.txt` is encoded in cp932 (Shift-JIS).
- All `daily.csv` and `quarterly.csv` files are UTF-8.
- Tools that auto-detect the description's encoding and reuse it will
  fail on the data files.
- Recommended fix: standardize on UTF-8.

### Check 2 — OHLC inequalities (5 rules)

Same rules as A-share. Run after translating Japanese column names to
English (始値→open, 高値→high, 安値→low, 終値→close).

**NOT FOUND.** All 20 TSE symbols have valid OHLC.

### Check 3 — Nulls in daily prices

Any null in `daily.csv` indicates a halt or feed gap.

**NOT FOUND.** No nulls.

### Check 4 — Quarterly CSV scanning

The Sonnet baseline never scanned `quarterly.csv` files. We at least
parse them and report null counts in fundamental columns (revenue,
ebitda, eps_diluted).

**NOT FOUND.** Quarterly files parse cleanly with no null fundamentals.

### Check 5 — Date format YYYY/MM/DD

The dates themselves are valid; flagged for cross-market joining.

**FOUND in this dataset (info):**
- `2025/09/02` style format flagged.
- Recommended fix: `pd.to_datetime(col, format='%Y/%m/%d')`.

### Check 6 — Duplicate trading-day rows

A daily file should have exactly one row per trading day.

**FOUND in this dataset:**
- TSE 9984 (SoftBank) has 118 rows but only 117 unique dates. One date
  is duplicated (e.g. 2025/12/15 appears twice).
- Recommended fix: `df.drop_duplicates(subset='日付', keep='last')` on
  read. Then ask the vendor why their pipeline emitted the duplicate.

---

## CROSS-MARKET — checks that span multiple feeds

### Check 1 — BABA (NASDAQ) ↔ 9988.HK (HKEX) dual-listing correlation

Alibaba is the same company, listed on both NASDAQ (as BABA, in USD) and
HKEX (as 9988.HK, in HKD). Same news, same earnings, same legal events
affect both. So their daily *percentage returns* must correlate strongly
(typical healthy correlation: 0.6-0.9).

If the correlation is below 0.3, one feed has a problem — wrong dates,
wrong prices, or symbol confusion.

**FOUND in this dataset (info — healthy):**
- Correlation = 0.977 at 0-day lag.
- Both feeds are highly consistent with each other.
- No action needed.

### Check 2 — 601318 (ashare) ↔ 2318.HK (HKEX) dual-listing correlation

Ping An Insurance is dual-listed on Shanghai (601318) and Hong Kong
(2318.HK). Same logic as the BABA pair.

**FOUND in this dataset (warning):**
- The scanner highlights **2025-11-20** as the worst-disagreement day.
  On that date the ashare close jumps +900% (the corrupted value) while
  2318.HK is unchanged in HKD.
- This is **independent confirmation** of the same root cause that the
  ashare scanner caught via OHLC violation, extreme move, and daily↔30min
  mismatch — five different mechanisms all pointing at the same cell.

---

## Severity legend

| Severity | Meaning | Example |
|---|---|---|
| **critical** | Hard logical violation. Backtest results using this row are wrong. | close > high |
| **warning** | Suspicious. Could be a real event (split, halt) or an export bug. Investigate. | 50% one-day price drop |
| **info** | Format / methodology note. Nothing is corrupt, but downstream code needs to know about the convention before joining markets. | NYSE uses MM/DD/YYYY, NASDAQ uses ISO 8601 |