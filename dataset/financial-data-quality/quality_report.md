# Financial Data Quality Report

_Generated 2026-05-09T08:11:51_

- Total issues: **24** (critical 4 / warning 14 / info 6)
- Markets: ashare, hkex, nasdaq, nyse, tse, cross_market
- Files scanned: 77 (ashare=12, hkex=2, nasdaq=20, nyse=3, tse=40, cross_market=0)

## Issues by category

| Category | Critical | Warning | Info | Total |
|---|---:|---:|---:|---:|
| Outlier | 3 | 3 | 0 | 6 |
| Format | 0 | 3 | 2 | 5 |
| Type Error | 1 | 2 | 0 | 3 |
| Missing Data | 0 | 1 | 2 | 3 |
| Cross-Field Inconsistency | 0 | 2 | 0 | 2 |
| Methodology Warning | 0 | 1 | 1 | 2 |
| Cross-Market Inconsistency | 0 | 1 | 1 | 2 |
| Cross-File Inconsistency | 0 | 1 | 0 | 1 |

## Cascading findings

Two or more independent checks fired on the same `(symbol, date)`. Each group below is one root-cause bug cross-validated by multiple detectors — strong evidence the underlying data is broken, not just noise from a single noisy check.

### Group #1 — 601318 on 2025-11-20 (3 issues: 1 critical, 2 warning)
- *critical* `Outlier` (ashare / daily/close.h5, daily/high.h5): Close exceeds High on 2025-11-20 for 601318: 370.080 vs 37.317 (close > high).
- *warning* `Outlier` (ashare / daily/close.h5): Single-day move of +900.4% — A-share normal limit is +/-10%.
- *warning* `Cross-Market Inconsistency` (cross_market / ashare/daily/close.h5 (601318) vs hkex/daily_prices.csv (2318.HK_Close)): LOW dual-listing correlation: 601318 vs 2318.HK daily-return rho = -0.176 at lag 1 day(s). Worst-disagreement day: 2025-11-20 (601318 +900.4% vs 2318.HK +0.8%). Same underlying company; healthy dual listings sit at 0.6-0.9.

### Group #2 — NVDA on 2025-10-15 (2 issues: 2 critical)
- *critical* `Outlier` (nasdaq / NVDA.csv): 1 negative value(s) in column 'volume' (first: -895328267.7192). This column is documented as non-negative.
- *critical* `Outlier` (nasdaq / NVDA.csv): 1 negative value(s) in column 'shares_traded' (first: -7091128.0000). This column is documented as non-negative.

## Critical (4)

### Critical #1 — ashare / Type Error
- **Symbol:** ALL
- **Date:** all
- **Document:** daily/{turnover}.h5
- **Issue:** Column-dtype mismatch across daily field files: {'open': 'str', 'high': 'str', 'low': 'str', 'close': 'str', 'volume': 'str', 'turnover': 'int64'}. Majority is 'str'. Files with int64 columns silently strip leading zeros from symbol codes (e.g. '000333' becomes 333), so joins between files will mis-align.
- **Recommended fix:** Re-export the offending file(s) with explicit string symbol codes. Or on read, coerce: df.columns = df.columns.astype(str).str.zfill(6).

### Critical #2 — ashare / Outlier
- **Symbol:** 601318
- **Date:** 2025-11-20
- **Document:** daily/close.h5, daily/high.h5
- **Issue:** Close exceeds High on 2025-11-20 for 601318: 370.080 vs 37.317 (close > high).
- **Recommended fix:** Re-fetch from WindQuant. Ratio 9.92 suggests a 10x decimal error; dividing by 10 gives 37.008.

### Critical #3 — nasdaq / Outlier
- **Symbol:** NVDA
- **Date:** 2025-10-15T00:00:00Z
- **Document:** NVDA.csv
- **Issue:** 1 negative value(s) in column 'volume' (first: -895328267.7192). This column is documented as non-negative.
- **Recommended fix:** Re-fetch from vendor. Sustained negatives suggest a sign-flip in the export pipeline.

### Critical #4 — nasdaq / Outlier
- **Symbol:** NVDA
- **Date:** 2025-10-15T00:00:00Z
- **Document:** NVDA.csv
- **Issue:** 1 negative value(s) in column 'shares_traded' (first: -7091128.0000). This column is documented as non-negative.
- **Recommended fix:** Re-fetch from vendor. Sustained negatives suggest a sign-flip in the export pipeline.

## Warning (14)

### Warning #1 — ashare / Outlier
- **Symbol:** 601318
- **Date:** 2025-11-20
- **Document:** daily/close.h5
- **Issue:** Single-day move of +900.4% — A-share normal limit is +/-10%.
- **Recommended fix:** Cross-check WindQuant. If real, likely post-halt resumption or rights issue; otherwise re-fetch. Apply split/dividend adjustment if the underlying corporate action is missing.

### Warning #2 — ashare / Outlier
- **Symbol:** 601318
- **Date:** 2025-11-21
- **Document:** daily/close.h5
- **Issue:** Single-day move of -89.8% — A-share normal limit is +/-10%.
- **Recommended fix:** Cross-check WindQuant. If real, likely post-halt resumption or rights issue; otherwise re-fetch. Apply split/dividend adjustment if the underlying corporate action is missing.

### Warning #3 — ashare / Cross-File Inconsistency
- **Symbol:** multiple
- **Date:** multiple
- **Document:** daily/close.h5 vs 30min/close.h5
- **Issue:** 1 (symbol,date) pairs where the last 30min bar close disagrees with daily close by more than 0.1%. The two feeds describe the same trading day and should agree.
- **Recommended fix:** Identify the divergent rows by re-running this check; the daily feed and intraday feed are sourced separately at WindQuant. Trust whichever is later-stamped or re-fetch both.

### Warning #4 — ashare / Type Error
- **Symbol:** 000001
- **Date:** multiple
- **Document:** 30min/volume.h5
- **Issue:** Numeric 30min/volume column(s) contain non-numeric strings, e.g. 000001='suspended' (8 affected cells). pd.to_numeric will raise unless errors='coerce' is passed.
- **Recommended fix:** On read: df = df.apply(pd.to_numeric, errors='coerce'). Investigate whether 'suspended' rows should be NaN or carry a separate halt-indicator column.

### Warning #5 — hkex / Cross-Field Inconsistency
- **Symbol:** ALL
- **Date:** 2025-10-20 00:00:00+08:00
- **Document:** daily_prices.csv
- **Issue:** 2 rows share ['Datetime'] with another row (1 duplicate keys). Each key combination should be unique.
- **Recommended fix:** De-duplicate on read: df.drop_duplicates(subset=['Datetime']). Then investigate the vendor pipeline for the source of duplicates.

### Warning #6 — nasdaq / Type Error
- **Symbol:** ALL
- **Date:** multiple
- **Document:** ALL nasdaq CSV files
- **Issue:** Fundamental field(s) contain literal '--' string instead of NaN: eps_diluted (122 rows), book_val_per_sh (122 rows). Forces column dtype=object; numeric operations like .mean() will raise.
- **Recommended fix:** df[col] = pd.to_numeric(df[col], errors='coerce') for each affected column.

### Warning #7 — nasdaq / Outlier
- **Symbol:** GOOGL
- **Date:** 2025-11-03T00:00:00Z
- **Document:** GOOGL.csv
- **Issue:** Price jump 329.90 -> 158.49 (-52%). Likely an unadjusted stock split or corporate action.
- **Recommended fix:** Check the corporate-actions calendar for GOOGL on this date. If a split, apply backward adjustment factor 0.4804 to all pre-split prices.

### Warning #8 — nasdaq / Missing Data
- **Symbol:** TSLA
- **Date:** 2025-12-12 -> 2025-12-22
- **Document:** TSLA.csv
- **Issue:** Calendar gap of 10 days between adjacent rows. Suggests roughly 7 missing trading day(s) (after subtracting one weekend).
- **Recommended fix:** Cross-check the NASDAQ trading calendar (no scheduled early-close gaps in this period). Likely a vendor feed outage. Re-fetch from BQuant.

### Warning #9 — nyse / Methodology Warning
- **Symbol:** ALL
- **Date:** all
- **Document:** ALL .h5 files
- **Issue:** Both fiscal_period_end and report_date are present. Using fiscal_period_end as the data-availability date introduces look-ahead bias — companies typically file weeks-to-months after quarter end. Backtests using fiscal_period_end will perform unrealistically well.
- **Recommended fix:** Always filter by report_date: df[df['report_date'] <= analysis_date]. Treat fiscal_period_end as metadata, not as a timestamp.

### Warning #10 — nyse / Format
- **Symbol:** ALL
- **Date:** 2025-12-15
- **Document:** 2025-09-30.h5
- **Issue:** 18 row(s) where tz_offset disagrees with the DST regime of update_timestamp. Example: update_timestamp=2025-12-15 is stamped -04:00 but should be -05:00 (US DST 2025 ran 03/09 to 11/02). Downstream code that converts to UTC using tz_offset will land on the wrong absolute time by 1 hour.
- **Recommended fix:** Verify with FactQuant. Either re-derive tz_offset from the timestamp, or convert to UTC by parsing the date with America/New_York and letting pandas pick the correct offset automatically.

### Warning #11 — nyse / Format
- **Symbol:** ALL
- **Date:** 2026-03-15
- **Document:** 2025-12-31.h5
- **Issue:** 4 row(s) where tz_offset disagrees with the DST regime of update_timestamp. Example: update_timestamp=2026-03-15 is stamped -05:00 but should be -04:00 (US DST 2025 ran 03/09 to 11/02). Downstream code that converts to UTC using tz_offset will land on the wrong absolute time by 1 hour.
- **Recommended fix:** Verify with FactQuant. Either re-derive tz_offset from the timestamp, or convert to UTC by parsing the date with America/New_York and letting pandas pick the correct offset automatically.

### Warning #12 — tse / Format
- **Symbol:** ALL
- **Date:** all
- **Document:** data_description_tse.txt vs */daily.csv
- **Issue:** Encoding mismatch within the same market: description file is cp932 but daily CSVs are utf-8. Tools that auto-detect the description's encoding and reuse it will fail on the data files.
- **Recommended fix:** Standardize on UTF-8. Re-export the description file from the vendor with -encoding utf-8.

### Warning #13 — tse / Cross-Field Inconsistency
- **Symbol:** 9984
- **Date:** 2025/12/15
- **Document:** 9984/daily.csv
- **Issue:** 2 rows share ['date'] with another row (1 duplicate keys). Each key combination should be unique.
- **Recommended fix:** De-duplicate on read: df.drop_duplicates(subset=['date']). Then investigate the vendor pipeline for the source of duplicates.

### Warning #14 — cross_market / Cross-Market Inconsistency
- **Symbol:** 601318 / 2318.HK
- **Date:** 2025-11-20
- **Document:** ashare/daily/close.h5 (601318) vs hkex/daily_prices.csv (2318.HK_Close)
- **Issue:** LOW dual-listing correlation: 601318 vs 2318.HK daily-return rho = -0.176 at lag 1 day(s). Worst-disagreement day: 2025-11-20 (601318 +900.4% vs 2318.HK +0.8%). Same underlying company; healthy dual listings sit at 0.6-0.9.
- **Recommended fix:** Investigate one of the feeds. Check date alignment, symbol mapping, FX rate, or unhandled corporate actions. The worst-day disagreement above is a good starting point.

## Info (6)

### Info #1 — ashare / Missing Data
- **Symbol:** multiple
- **Date:** multiple
- **Document:** daily/{open,high,low,close}.h5
- **Issue:** 5 rows where ALL OHLC fields are null on the same (symbol, date) — consistent with trading halts/suspensions, not errors.
- **Recommended fix:** Treat as expected. Mark with a halt indicator column rather than forward-filling, since halt periods carry meaningful information.

### Info #2 — hkex / Missing Data
- **Symbol:** ALL
- **Date:** all
- **Document:** intraday_30min.csv
- **Issue:** 2420 null Close values at 12:30 (lunch break) across all symbols. This is the documented expected behaviour for HKEX intraday.
- **Recommended fix:** Drop or skip 12:30 rows before analysis. Do NOT forward-fill — post-lunch prices reflect new information.

### Info #3 — nyse / Format
- **Symbol:** ALL
- **Date:** all
- **Document:** ALL .h5 files
- **Issue:** fiscal_period_end / report_date / update_timestamp use MM/DD/YYYY format. Other markets use ISO 8601 (YYYY-MM-DD). The dates themselves are valid; the inconsistency causes silent locale-dependent mis-parsing on cross-market joins.
- **Recommended fix:** On read: pd.to_datetime(df['fiscal_period_end'], format='%m/%d/%Y'). Then standardize to ISO before joining with NASDAQ/HKEX/etc.

### Info #4 — nyse / Methodology Warning
- **Symbol:** ALL
- **Date:** all
- **Document:** 2025-06-30, 2025-09-30, 2025-12-31
- **Issue:** None of the 3 snapshot files share any (ticker, fiscal_period_end) row. Each file contains only the single quarter that matches its own filename. Production NYSE feeds usually carry overlapping history so users can detect vendor restatements; the absence of overlap here means the dataset cannot be used to verify point-in-time stability.
- **Recommended fix:** Request that FactQuant emit cumulative snapshots (every snapshot includes all prior quarters) rather than per-quarter slices.

### Info #5 — tse / Format
- **Symbol:** ALL
- **Date:** all
- **Document:** ALL <symbol>/daily.csv
- **Issue:** Date format is YYYY/MM/DD (e.g. '2025/09/02'). NASDAQ uses ISO 8601 (with 'T' and 'Z'); NYSE uses MM/DD/YYYY. Cross-market joins require standardization.
- **Recommended fix:** pd.to_datetime(df['date'], format='%Y/%m/%d') on read.

### Info #6 — cross_market / Cross-Market Inconsistency
- **Symbol:** BABA / 9988.HK
- **Date:** 2026-02-03
- **Document:** nasdaq/BABA.csv vs hkex/daily_prices.csv (9988.HK_Close)
- **Issue:** OK dual-listing correlation: BABA vs 9988.HK daily-return rho = 0.977 at lag 0 day(s). Worst-disagreement day: 2026-02-03 (BABA +1.8% vs 9988.HK -1.6%). Same underlying company; healthy dual listings sit at 0.6-0.9.
- **Recommended fix:** No action needed.
