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
| `serve.py` | Local server: serves the page **and** fetches live prices for it |
| `fetch_prices.py` | Writes `prices.js`, a dated price snapshot the page loads on its own |
| `rulebook-explained.html` | Plain-English guide, with a generated reference of all 25 rulebooks |
| `build/gen_reference.js` | Regenerates that reference from `rulebook.js` + the data files |
| `rulebook-why.js` | One explanation per measure — why it is on the rulebook at all |

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
There are three ways to put a current price in front of them.

**1. Live, locally.** A published Artifact is sandboxed and cannot make any outbound
request, so it can never call Yahoo itself. Run the page from here instead:

```bash
python3 serve.py            # then open http://localhost:8765
```

The page detects the local service and the Prices panel gains *Refresh the companies shown*
and *Refresh all 200*. Quotes come from Yahoo Finance (`query1.finance.yahoo.com`, no key),
falling back to stockanalysis.com when Yahoo rate-limits the caller. SGX codes are mapped
automatically (`D05` → `D05.SI`), as are `BRK.B` → `BRK-B` and the two benchmarks
(`^GSPC`, `^STI`).

**2. A snapshot baked in.** `python3 fetch_prices.py` writes `prices.js`; add
`<script src="prices.js"></script>` before `app.js` and the page opens with those prices
applied, labelled *Snapshot price* with the date taken.

**3. Paste.** The Prices panel accepts CSV or TSV bars with or without a header; a `Symbol`
column loads many companies at once. Benchmark tickers are recognised too.

However the price arrives, P/E, P/B, P/S, P/FCF, dividend yield and market cap are recomputed
as that close divided by the per-share figures from the filings. EV-based multiples are left
alone, since enterprise value needs the debt and cash of the same date.

## The guide

`rulebook-explained.html` explains the rulebooks for someone with no finance background,
and ends with a reference: every rulebook, its measures, the level that counts as healthy,
and the median across the companies on this list that use it. That section is **generated**:

```bash
node build/gen_reference.js     # writes /tmp/industry_ref.html
```

so it cannot drift from `rulebook.js`. The generated block sits between `<!--REF:START-->`
and `<!--REF:END-->` in the page; re-run the script and swap that block after changing any
rulebook.

`rulebook-why.js` holds two maps. `RULE_WHY` is one short description per measure (112 of
them, keyed by label) — the guide shows it inside the measure's dropdown, the checklist as
hover text. `RULE_LEVEL` is the threshold in as few words as possible, keyed
`"<rulebook>|<measure>"` (139 rows), which is what the reference table prints; the full
wording stays in `rulebook.js` and appears under the description when a row is opened.

Adding a measure without adding either entry is harmless — the table falls back to the full
wording and omits the description — but `node -e` over both files will tell you what is
missing.

## The journal

Section 6 of each company stamps your thesis with the date and the price, freezes it, and
sets a review date. When that date arrives the company is flagged *Review due* and the page
asks three questions borrowed from TradingAgents' reflection step: which part of the thesis
held, which part broke, and one lesson. Returns are shown against the S&P 500 or the Straits
Times Index over the same window, so a review tells you whether you beat owning the index
rather than whether the number went up. The stamped thesis is read-only — *Restate the
thesis* keeps the old one in history rather than editing it.

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
