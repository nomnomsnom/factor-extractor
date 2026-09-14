# market_brief

Fills the `market/latest` document that the **Tape and Signal** dashboard reads.

The dashboard's HTML is never touched by this job. It renders whatever is in that
one document, and it is built to render partial data and to say what it is
missing. A hole is correct; a guess is not.

## The rules this pipeline enforces in code

1. **No invented numbers.** If a source fails, the instrument or the session is
   omitted. `validate.py` fails the run rather than let a hole be filled.
2. **No interpolation, no back-fill.** A missing session is a missing row.
   Holidays simply are not there — 7 September 2026 is absent everywhere because
   US markets were shut for Labor Day.
3. **Levels and percent changes come from the same series.** Every `pct` is
   computed from the closes shipped next to it, and `validate.py` re-derives
   each one and fails on a mismatch beyond a rounding step.
4. **Intraday is never a close.** `build.py` drops every bar dated on or after
   the session in progress. Intraday readings appear in `note` text, labelled,
   and nowhere else.
5. **Yields carry `pct: null`.** A yield move is basis points; the page renders
   an em dash rather than a misleading percentage, and the basis-point move goes
   in the note.

## Sources

| what | where | why |
|---|---|---|
| index, commodity and single-name closes | Yahoo Finance `v8/finance/chart` | the brief's primary price source |
| same, if the JSON API rate-limits | Yahoo `/quote/<sym>/history/` table | same provider, same numbers, different door |
| Treasury constant-maturity yields | FRED `fredgraph.csv` (`DGS10`, `DGS2`, `DGS20`) | the primary series for yields, and needs no API key |

Yahoo's `query1`/`query2` hosts return `429` from some egress IPs. `fetch_yahoo.py`
falls back to the history page automatically and records which door it used in
each raw file's `source` field.

Two things are deliberately *not* sources: a model's recollection of a price, and
a percent change lifted from a provider other than the one that supplied the level.

## Running it

```sh
python3 fetch_yahoo.py '%5EGSPC' '%5EIXIC' '%5EDJI' '%5ERUT' '%5EVIX' \
                       'BZ%3DF' 'CL%3DF' '%5EN225' '%5EHSI' '%5ESTI' '%5ETNX' \
                       NVDA AMD MU INTC AAPL META GOOGL AMZN MRVL TSM AVGO
python3 fetch_fred.py DGS10 DGS2 DGS20
python3 build.py        # -> market-latest.json
python3 validate.py     # must print RESULT: PASS before anything is published
```

Then write it, and verify by reading it straight back:

```
Artifact(action: "write_db",
         url: "https://claude.ai/code/artifact/7191ed69-823c-4496-ae40-c00cea762c1b",
         db_op: "set", collection: "market", doc_id: "latest",
         file_path: "./market-latest.json")
```

Optionally archive the same file at `collection: "market/latest/archive"`,
`doc_id: <YYYY-MM-DD>`, so the history is ours rather than the provider's if a
figure is later revised.

Environment knobs: `BRIEF_TODAY` overrides the session-in-progress date when
back-filling, `BRIEF_SESSIONS` sets the series length (default 22, about a
month), `FRED_START` sets how far back FRED is pulled.

## What is not automated

**The `news` and `gaps` arrays are written by hand each run.**

`why` is written by hand too, and this is the part that was got wrong once
already, so it is worth stating plainly.

**A narrative cannot be a template.** `why_from_doc.py` tried: fixed sentences
with the numbers interpolated. On 11 September the tape reversed — equities up,
oil down, VIX down 11% — and the bullets still led with "Oil is the origin, not
a symptom", because only the figures were refreshing. Prices changed; the read
did not. That module is kept only as an emergency repair for a document that
shipped with no bullets at all.

What runs now is a split:

- `why_facts.py` computes the **state of the tape** and nothing else — per
  instrument one-, five- and twenty-session changes, the day's leaders and
  laggards, whether each instrument reversed or confirmed its own trend, the
  curve, the VIX band, breadth, and a list of `signals` naming what actually
  changed this session (oil fell but yields rose; the VIX collapsed; small caps
  lagged). Facts, never prose.
- The person or agent running the job reads those signals and **writes the
  bullets fresh**, quoting figures out of the facts so they cannot drift from
  the series the charts plot.

**Write for someone with no finance background.** This is a standing
requirement, not a preference. "Brent gave back 2.8%" and "the 10-year rose
12bp" are not English to most readers, and a bullet that assumes you already
know why an oil price moves a bond yield has explained nothing. Say what the
number is (`4.95%, up from 4.83%`), say what a named thing is the first time it
appears (`the Russell 2000, an index of 2,000 smaller US companies`), and spell
out the mechanism in everyday words — expensive oil, higher prices, a central
bank more likely to raise rates, dearer borrowing, shares worth less.

`validate.py` enforces all three halves:

- it fails a document whose instruments sit more than a session apart (FRED
  yields exempted, since they publish late by design) — the 12 September run
  shipped Asia a session stale beside fresh US closes and nothing complained;
- it fails a document whose `why` leads are mostly the same sentences as the
  last committed brief while the newest session has advanced. A read that did
  not change when the market did is not a read;
- it fails a document whose `why` uses jargon from a fixed list, and names the
  plain phrasing to use instead. Run it against the 11 September bullets and it
  returns ten failures — "gave back", "12bp", "front end", "the curve", "risk
  premium" and so on. It also warns when a named index or gauge is used without
  saying what it is, and when a sentence runs past about forty words.

```sh
python3 why_facts.py market-latest.json        # what changed this session
python3 why_facts.py market-latest.json --json # same, for a script
```

`build.py` carries the previous brief's bullets forward so the document stays
structurally valid. That is deliberately not good enough to ship: the staleness
check then fails, which is what forces the rewrite. It does NOT regenerate from
`why_from_doc.py`, whose fixed sentences are both stale and written in the jargon
the reader asked us to drop.

## Finding finance and quant-industry news

This is the reader's stated first interest after market events, and it is the
part that most often comes up empty, because those stories do not break daily.
The 15 September run found nothing that survived checking: a quant drawdown
piece and a China quant selloff piece both turned out to be from January and
July, and an SEC cross-margining approval turned out to be April. It said so in
`gaps` rather than padding the list, which is the right call.

So the bar is the date, not the age. An item up to about two weeks old is fine
if it is genuinely notable and carries its real date — the page shows dates and
sorts by them, so nothing is passed off as newer than it is. Places worth
checking, in rough order of how often they yield something dateable:
SEC and CFTC press rooms, the Federal Register, FINRA and exchange notices, HFR
monthly index releases, Hedgeweek, With Intelligence, Risk.net, and the 8-K and
13-D filings of the listed exchanges and brokers.

What does not count: an undated listicle, a "top quant firms 2026" SEO page, or
a search summary whose date you have not confirmed on the source page itself.
 They are the point
of the dashboard, and they are the part a script cannot do: the headlines have to
be read, the figures checked against a primary source where one exists, and
anything that cannot be dated to a confirmed source has to be left out and said
out loud in `gaps`. `build.py` holds the current text inline; rewrite that block,
do not extend it mechanically.

`validate.py` does check the mechanical properties of what you write: dates are
real and not in the future, `cat` is one of `mkt`/`ai`/`flag`, URLs are absolute,
and no format placeholder survived into prose.

## The page

`dashboard.html` is the published artifact's source, kept here so the page and the
job that feeds it stay in one place.

The page holds **no market data of its own**. A published artifact cannot reach
Yahoo, FRED or any other host — the viewer's CSP blocks outbound `fetch`/XHR
entirely — so a page that appeared to quote a live price would be quoting a number
somebody typed into it. Instead it subscribes to `market/latest` with
`onSnapshot`, renders whatever is there, and renders nothing at all when the
document is missing. There is no seeded fallback: a stale number shown
confidently is the failure this design exists to prevent.

Consequences worth knowing:

- The brief appears as soon as the page opens. No button press.
- A brief written while a tab is open replaces what is on screen, live.
- Past `STALE_HOURS` (72, which survives a normal weekend) the page says how old
  the brief is in a banner rather than letting it pass as this morning's.
- `snap.data()` is a **call**, not a property. Reading it as a property yields the
  function and every `Array.isArray(d.instruments)` check fails, which silently
  reports a full feed as empty. The first version of this page had that bug.

## Scheduling

It runs as a Routine: `0 22 * * 1-5` UTC, which is 06:00 SGT Tuesday to Saturday,
about two hours after the US close. Each firing starts a fresh session that clones
this branch, runs the pipeline, rewrites the news by hand, validates, and writes
`market/latest`.

A silent failure that leaves a stale `asOf` is worse than a visible error, because
the page would look current while showing old numbers. Two things guard against
that: the job is told to write any failure into `gaps`, and the page itself puts up
a banner once a brief passes 72 hours old.
