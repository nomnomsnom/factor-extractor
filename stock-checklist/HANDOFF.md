# Handoff: build a live dashboard on the Two Hundred Filings dataset

**For: a Claude Code session running on the user's own machine (not sandboxed).**
**Goal: a dashboard over the existing 200-company dataset, with live prices from Yahoo Finance.**

Written 16 September 2026 by the Claude Code web session that built everything described below.
Everything here is on branch `claude/investment-tracker-html-qane4y` of
`github.com/nomnomsnom/factor-extractor`, under `stock-checklist/`.

---

## 1. Why this handoff exists

The web session was sandboxed: **the published Artifact cannot make any outbound network
request**, and the build environment's egress IP is rate-limited by Yahoo (every call returned
`HTTP 429`). So the live-price path was built but never exercised against the real Yahoo
endpoint — only against a fixture, plus a working fallback scraper.

Your environment does not have that restriction. The first useful thing you can do is make the
Yahoo path actually work, then build the dashboard on top of it.

**Do not re-derive the dataset.** It took ~1,000 HTTP requests, an SEC XBRL crawl and three
hand-read bank PDFs to assemble. It is committed. Read it, don't rebuild it.

---

## 2. What already exists

| File | Size | What it is |
|---|---|---|
| `data-us.js` | 643 KB | `window.DATA_US` — 100 largest S&P 500 companies by market cap |
| `data-sg.js` | 559 KB | `window.DATA_SG` — 100 largest Singapore-listed companies (97 SGX + `SE`, `GRAB`, `KARO` which are Singapore-HQ but US-listed) |
| `rulebook.js` | 25 KB | `window.RULEBOOKS` — 25 industry rulebooks, 139 measures, plus `window.rulebookFor(company)` |
| `rulebook-why.js` | 32 KB | `window.RULE_WHY` (112 measure explanations) and `window.RULE_LEVEL` (139 short thresholds) |
| `index.html` + `app.js` | 26 KB + 71 KB | The existing checklist page (not a dashboard — a research workbench) |
| `rulebook-explained.html` | 115 KB | Plain-English guide; its reference section is generated |
| `serve.py` | 6 KB | Local server + price proxy. **Start here.** |
| `fetch_prices.py` | 2 KB | Writes `prices.js`, a static dated snapshot |
| `build/` | — | Crawlers and merge scripts that produced the data files |

Published artifacts (the user's, already live):
- Checklist: https://claude.ai/artifact/7tfubxQVFAKB1iBtrTZw1i
- Guide: https://claude.ai/artifact/Mx7To5mmEQKDp4NRN5B6sN

---

## 3. Data shapes

Both data files are plain JS assignments — `window.DATA_US = [ {...}, ... ];` — so they can be
`eval`'d in Node, imported in a browser, or parsed as JSON after stripping the assignment:

```js
const data = JSON.parse(fs.readFileSync('data-us.js','utf8').split('=',2)[1].replace(/;\s*$/,''));
```

### Company record

```
r        rank by market cap within its list        t      ticker ("D05", "BRK.B")
n        company name                              mkt    "US" | "SGX"  (the exchange)
list     "US" | "SG"                               cur    "USD" | "SGD"
sec      sector          indu   industry           ceo, founded, site, country, exch, rcur, fyend
execs    [[name, role], ...]                       desc   company description from filings
M        62 point-in-time metrics (below)          S      13 annual series, newest first
R        12 ratio series by fiscal year            fy/ry  period labels for S and R
segs     [{n: segment name, v: [values]}]          pe_med 5-year median P/E
vs_hist  % current P/E is above/below pe_med       rev5   5-year revenue CAGR %
flags    booleans used by the page's filters       q      12 written research fields
F        filled metrics from SEC XBRL / filings (188 of 200 companies)
```

`M` keys (all **strings** as reported — `"38.12"`, `"4.86T"`, `"48.65%"`, `"n/a"`; parse with a
`num()` helper, one exists in `app.js`):

```
mcap ev pe fpe ps pb pfcf peg evebitda evfcf gm om pm fcfm ebitdam roe roa roic roce wacc
de debitda dfcf icov current rev ni ebitda fcf ocf capex netcash debt eps bvps shares shchg
insiders inst employees divy dps payout divgrow buyback fcfy ey fcfps ncps beta chg52
altman piotroski pt ptd cons analysts revf3 epsf3 earnings tax rps
```

`S` (annual, index 0 = TTM): `revenue revg gm om pm fcf fcfm ni eps dps ocf capex netcash`
`R` (by fiscal year, index 0 = current): `pe ps pb pfcf evebitda roic roe de nde divy buyback payout`
`fy` = `["TTM","FY 2026","FY 2025","FY 2024","FY 2023","FY 2022"]`
`F` keys: `gearing rdPct sbcPct invDays rpo allowPct ldr cti cet1 nim npl`, each `{v, p, s}`
where `v` is the number, `p` the period, `s` the source string to display.
`q` keys: `what rev gm mgmt comp moat moatTags ind risk implied debate disprove`

### Rulebooks

`window.rulebookFor(company)` returns `{name, decides, watch[], ignore[]}`. Each `watch` entry:

```
l      label (the key into RULE_WHY)
t      full threshold wording          k     key into company.M
ok     optional (v) => boolean test    c     computed key (spread, rev5, rule40, capexPct,
f      where to read it in the filing        fcfConv, divCover, dpsTrend, topSeg, omRange)
fill   key into company.F              u     '%' | 'days' | 'money'
```

`RULE_LEVEL` is keyed `"<rulebook name>|<measure label>"`. `RULE_WHY` is keyed by label alone.
`app.js` has `rbEval(company)` which evaluates all of this — **reuse it rather than
reimplementing the precedence** (`fill` beats `k` beats `c`).

### Browser state the existing page writes

```
localStorage "tf.notes.v1"  { TICKER: { c:{checkId:true}, n:{why,rebut,disprove,sell,size,horizon},
                                        j:{journal}, u:timestamp } }
localStorage "tf.bars.v1"   { TICKER: { px, d:"YYYY-MM-DD", s:[closes], h:[[date,close]], n, src } }
```
`src` is `"you" | "live" | "snapshot"`. Journal entries hold `{open, px, cur, review, bench:{k,n,level},
thesis:{...}, reviews:[{d,verdict,px,ret,alpha,held,failed,lesson}], history:[]}`.
If the dashboard shares a browser origin with the checklist, it can read these directly.

---

## 4. Yahoo Finance — what is known to work and what is not

`serve.py` already implements this. Read it before writing your own.

**Symbol mapping** (`yahoo_symbol(ticker, market)`):
- SGX tickers get `.SI` appended — `D05` → `D05.SI`, `C38U` → `C38U.SI`
- US tickers replace `.` with `-` — `BRK.B` → `BRK-B`
- Benchmarks pass through: `^GSPC` (S&P 500), `^STI` (Straits Times Index)
- `SE`, `GRAB`, `KARO` are in `DATA_SG` but list on US exchanges — they take the US mapping.
  **Check `company.mkt`, not `company.list`, when building a symbol.**

**Endpoint used:** `https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=6mo&interval=1d`
Parsed from `chart.result[0].timestamp` and `chart.result[0].indicators.quote[0].close`,
skipping `null` closes. A browser-like `User-Agent` header is set; without one it fails more often.

**Untested:** the live call. The parser is correct against a fixture, the symbol mapping is
correct, but every real request from the build environment returned 429. **Verify first**, e.g.
`python3 -c "import serve; print(serve.from_yahoo('D05.SI'))"`. If you see 429s from your
machine too, the fallback below still works, and `query2.finance.yahoo.com` is worth trying.

**Fallback that is tested and working:** `from_stockanalysis()` scrapes the "Last Close Price"
row from `stockanalysis.com/.../financials/ratios/`. One price, no history. Confirmed returning
real values (NVDA 210.96, D05 76.75 on 15 Sep 2026).

**Rate limiting:** `serve.py` sleeps 0.12s between symbols and fetches in chunks of 20 from the
page. 202 symbols is roughly 30–60 seconds. Don't parallelise hard; Yahoo will block you.

---

## 5. Recomputing anything from a price

This is the part most likely to be got wrong.

Multiples in `M` were compiled on **14 September 2026**. Given a fresh price, recompute from
the **per-share fundamentals**, never by scaling the old multiple:

```
P/E            = price / M.eps          (181 of 200 have eps; skip if eps <= 0)
P/B            = price / M.bvps         (191)
P/FCF          = price / M.fcfps        (179)
P/S            = price / (M.rev / M.shares)
dividend yield = M.dps / price * 100    (169)
market cap     = price * M.shares       (192)
vs own history = (new P/E / pe_med - 1) * 100
```

**Do not rescale EV/EBITDA, EV/Sales or enterprise value.** Enterprise value needs the debt and
cash of the same date, which you do not have. Leave them labelled as of the compile date.
`adj()` in `app.js` does all of this correctly.

Currency: SGX names are in **SGD**, US names in **USD**. There is no FX conversion anywhere in
the dataset and none should be introduced silently. `company.cur` carries it.

---

## 6. How stale the numbers are, and how often to refresh

- **Prices:** refresh on demand. That's the dashboard's job.
- **Fundamentals:** most SGX companies report **half-yearly** ([SGX Rule 705](https://rulebook.sgx.com/rulebook/705)
  — quarterly only if auditors flagged the accounts); US companies report quarterly. So `M`, `S`,
  `R` and `F` change **2–4 times a year**, not daily. A dashboard that re-scrapes fundamentals
  nightly is wasted work.
- Reporting is clustered: of the 200, 95 report in October and 58 in November.
- To refresh fundamentals, re-run `build/crawl.py` → `build/crawl_bs.py` → `build/sec_fetch.py`
  → `sec_join.py` → `sec_derive.py` → `fills.py` → `build.py`. See `README.md`.

---

## 7. Suggested build

The existing `index.html` is a **research workbench** — 200 companies, one checklist each,
read slowly. A dashboard is a different job: few things, watched often. Build it as a new page
rather than bending the old one.

What would actually be useful, roughly in order:

1. **A watchlist view.** The user's own holdings and shortlist, not all 200. Source the tickers
   from `tf.notes.v1` (anything with a journal open or notes written) plus a manual list.
2. **Entry-price tracking.** The user's method is to set a target multiple in advance and wait.
   Show, per name: current price, current P/E, `pe_med`, `vs_hist`, and the price that would
   put it at its 5-year median. That last number is `pe_med * M.eps` — arguably the single most
   useful cell on the whole dashboard.
3. **Journal review queue.** `tf.notes.v1[t].j.review` is a date. Surface what is due, with
   return since `j.px` and the benchmark return since `j.bench.level` (`^GSPC` or `^STI` by
   `company.list`).
4. **Rulebook status per holding** — reuse `rbEval`, show `pass/tested` and any failing measure.
5. **Earnings calendar** from `M.earnings`, so the user knows when numbers actually change.

Charts: prefer real daily closes from Yahoo (`h: [[date, close]]`). The existing page has a
minimal `lineChart()` and `barChart()` in `app.js` if you want to stay dependency-free.

---

## 8. Design intent worth preserving

The user is a beginner investing real money, with a multi-year horizon. Several decisions were
deliberate and it would be easy to undo them by accident:

- **No buy/sell ratings, no scores, no "top picks".** The tool deliberately refuses to rank.
  The user writes the thesis; the software holds the evidence. Adding a recommendation engine
  would change what this is.
- **The journal thesis is frozen once stamped.** Restating archives the old version rather than
  editing it. That is the point — hindsight rewrites memory otherwise.
- **Every number states its source.** Filled metrics carry `F[key].s` — display it. Where a
  figure is a proxy rather than the real thing (allowance for loan losses is not the NPL ratio;
  Tier 1 is not CET1; computed gearing is not the MAS aggregate-leverage definition), the
  source string says so and that wording should survive.
- **No sentiment, no technical indicators.** Explicitly considered and rejected for a multi-year
  horizon; the checklist's own instruction is to use primary documents only.
- **Rulebooks are per-industry.** A bank's negative free cash flow is normal; a retailer's is
  not. Anything that scores all 200 companies on one set of metrics is wrong by construction.

---

## 9. First session checklist

```bash
git clone -b claude/investment-tracker-html-qane4y https://github.com/nomnomsnom/factor-extractor
cd factor-extractor/stock-checklist
python3 serve.py                      # http://localhost:8765 — the existing page, live mode on
python3 -c "import serve; print(serve.from_yahoo('D05.SI'))"   # does Yahoo answer you?
python3 -c "import serve; print(serve.quote('NVDA','US'))"     # full path with fallback
```

Then, before building anything, confirm you can reproduce these:

- `DATA_US.length === 100`, `DATA_SG.length === 100`
- `rulebookFor(DATA_SG.find(c=>c.t==='D05')).name === 'Banks'`
- `DATA_SG.find(c=>c.t==='D05').F.cti.v === 38.6` (DBS cost/income, 2Q26, read from their PDF)
- `DATA_US.find(c=>c.t==='NVDA').pe_med` — the 5-year median P/E the entry price keys off

Ask the user before: changing the dataset, adding any rating or recommendation feature, or
publishing anything that carries their notes.

---

## 10. Known gaps, honestly

- 498 of the rulebook's measure-rows across the 200 companies still have no data — occupancy,
  rental reversion, RevPAR, load factor, same-store sales, net revenue retention. These exist
  only in individual filings in inconsistent formats. The rows name the document instead.
- Per-share fundamentals are missing for some: 19 companies have no EPS (losses or n/a), so
  a recomputed P/E must degrade gracefully.
- `F` covers 188 of 200; 12 companies have no filled metrics at all.
- The Yahoo live path is unverified against the real endpoint (§4).
- Prices throughout are the 14 September 2026 compile. Everything price-derived in the shipped
  data is that old until refreshed.
