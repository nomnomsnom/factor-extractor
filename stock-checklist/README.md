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
| `build/` | The scripts and source data used to generate the two data files |

## Refreshing the data

Figures were pulled on 14 September 2026. To refresh:

```bash
cd build
python3 crawl.py          # fetches 4 pages per ticker into build/cache/ (~800 requests)
python3 build.py          # merges scraped metrics with qual/*.json into data-*.js
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
