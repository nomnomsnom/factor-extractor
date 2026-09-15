# Two Hundred Filings

A stock research checklist applied to 200 companies: the 100 largest members of the
S&P 500 by market capitalisation and the 100 largest companies listed in Singapore.

Each company expands into the same 23-question checklist (business, numbers,
competitive position, price, and the questions to answer before buying). Sections 1-4
are pre-filled; section 5 is yours to write, and your answers and ticks are saved in
the browser (and to your Claude account when the page runs as an Artifact).

## Files

| File | What it is |
|---|---|
| `index.html` | Page shell, design tokens, markup |
| `app.js` | Filtering, sorting, search, checklist rendering, note storage |
| `data-us.js` | 100 S&P 500 companies: metrics, 5-year history, segments, research notes |
| `data-sg.js` | 100 Singapore-listed companies, same shape |
| `rulebook.js` | Per-industry rulebooks: which metrics decide, thresholds, what to ignore |
| `build/` | The scripts and source data used to generate the two data files |

## Where each number comes from

| Source | What it fills |
|---|---|
| stockanalysis.com (4 pages/ticker) | ~106 standard metrics, 5-year history, segments, per-share figures |
| stockanalysis.com balance sheets | debt/assets gearing, allowance/gross loans, loans/deposits |
| SEC XBRL frames API (`data.sec.gov`) | R&D %, stock comp %, inventory days, remaining performance obligation, bank cost-to-income, Tier 1 ratio — US filers only |
| DBS, OCBC and UOB results documents | cost-to-income, NIM, NPL, CET1 for the three Singapore banks (read by hand; not in any feed) |
| `build/qual/*.json` | the written research answers |

Industry metrics that exist only in a specific filing (occupancy, rental reversion,
RevPAR, load factor, same-store sales, net revenue retention) are not filled. Those rows
name the document to read instead.

## Prices

No price data ships with the page. Multiples are the ones compiled with the fundamentals.
Paste your own bars into the Prices panel (CSV or TSV, with or without a header; a `Symbol`
column loads many companies at once) and P/E, P/B, P/S, P/FCF, dividend yield and market cap
are recomputed as your close divided by the per-share figures from the filings. EV-based
multiples are left alone, since enterprise value needs the debt and cash of the same date.

## Refreshing the data

Figures were pulled on 14 September 2026. To refresh:

```bash
cd build
python3 crawl.py          # 4 pages per ticker into build/cache/ (~800 requests)
python3 crawl_bs.py       # balance sheets, one more page per ticker
python3 sec_fetch.py      # SEC XBRL frames (~45 requests, all filers per tag)
python3 sec_join.py       # map tickers to CIK, slice the frames
python3 sec_derive.py     # ratios from the SEC values
python3 fills.py          # merge SEC + balance sheet + hand-read bank figures -> fills.json
python3 build.py          # merge everything with qual/*.json into data-*.js
cp data-us.js data-sg.js ..
```

`qual/*.json` holds the written research answers (business description, revenue mix,
moat, competitors, risk, valuation argument), keyed by ticker. Edit those by hand;
everything else comes from the scrape.

## Caveats

Quantitative figures come from stockanalysis.com, which compiles company filings; the
written answers are research notes. Both can be wrong or stale. Check the primary
document — SEC EDGAR for US listings, SGX announcements for Singapore — before acting.
Nothing here is financial advice.
