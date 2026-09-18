# backtest

Research code. Entirely separate from `market_brief/`, which is a live product
and is not touched by anything here.

## What it does

Long-only cross-sectional momentum (12-1) on large caps, US and Singapore,
with rebalancing frequency as the variable under test.

## The four design choices that decide whether a backtest lies

1. **No look-ahead.** The signal is built from data up to and including day t;
   the portfolio is invested from t+1. One day is skipped between formation and
   investment, which is what Frazzini/Israel/Moskowitz do, and it removes the
   fake profit bid-ask bounce otherwise hands to any short-horizon signal.
2. **Point-in-time universe.** "Large cap" is the top N by trailing 60-day
   dollar volume computed only from bars on or before the rebalance date. We
   have no historical constituent list; this is a proxy, but it is not today's
   winners applied to the past.
3. **Delisting is not a free exit.** A name whose data stops is held to its last
   print and sold there, never silently dropped.
4. **Costs charged on turnover inside the loop**, not subtracted at the end.

## Three ways the first results were wrong

Every one of these inflated the answer, and each was found by a check that is
now part of the harness.

**Price index vs total return.** The strategy trades on adjusted closes
(dividends reinvested) but was being compared to `^GSPC` and `^STI`, which are
price-only. That is not a small discrepancy: dividends are worth **1.78%/yr**
in the US and **4.03%/yr** in Singapore. Benchmarks are now SPY and ES3.SI.

**Survivorship in the candidate list.** The 159 US tickers were chosen in 2026,
so they are mostly companies that still exist and are still large. Equal-weight
that list and it beats the S&P by **2.85%/yr** before any signal is applied.
Hence every alpha is now measured against the equal-weight universe, which
carries the same bias, rather than against the index.

**A corrupt dividend adjustment.** Y92.SI's raw price fell 54% over the decade
while its adjusted series showed a **274x gain** — Yahoo compounding an annual
dividend wrongly, adding a fake +80% to +173% jump every February. Momentum
chased the artefact and it was producing half the Singapore alpha.
`datacheck.py` now flags any name whose total-return CAGR exceeds its
price-return CAGR by more than 15%/yr, and `engine.py` quarantines it.

## What could not be fixed

Eleven of 170 US candidates have no data on Yahoo at all: ATVI, CS, FRC, K,
MMC, NKLA, SIVB, SPLK, TWTR, VMW, WBA. These are companies that failed or were
absorbed. A momentum book would have held some of them on the way up and taken
the loss; this backtest cannot. The Singapore universe is worse — 30 names that
are in the STI *today*, applied back nine years.

## Running it

```sh
python3 fetch_history.py $(cat universe.txt) $(cat universe_sg.txt) SPY ES3.SI
python3 datacheck.py     # writes quarantine.json
python3 final.py         # headline table, both markets
python3 freq.py          # rebalance frequency sweep with t-statistics
python3 robust.py        # drop-the-winners and sub-period tests
```

## The finding

Over 2017-2026, US momentum beat its own universe by 6.93%/yr monthly, at a
trading cost of 0.16%/yr. The information ratio is 0.44, which over nine years
is **t = 1.32**. That is not significant. At the observed ratio it would take
**21 years** of data to reach t = 2, and there are nine.

Read that as: the harness is sound and the signal is not proven. Nine years and
a hand-built universe cannot separate this from luck.
