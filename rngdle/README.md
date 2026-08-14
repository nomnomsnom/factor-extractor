# RNGdle

A playable remake of [RNGdle](https://www.rngdle.com/), the daily game where you
don't guess anything.

Roll a number in `0 … 1,000,000`. The game scans it for patterns — primes,
palindromes, repeated digits, meme numbers, straights, terrain shapes — and awards
a badge for each one it finds. Every badge is worth some EP. Rarer badges are worth
dramatically more. That's the whole game: no strategy, just a result to discover.

Roll by hand, or turn on **auto-roll** and hunt: pick a speed, arm a stop condition
(a rarity tier, or the first badge you've never seen), and let it run until
something worth looking at comes up. There is no cooldown — the goal is to fill out
all 230 badges.

```
python3 -m http.server 8000    # then open http://localhost:8000/rngdle/
```

The source needs a server rather than `file://` because it is ES modules. There
are no dependencies — the only runtime requirement is a browser.

## Running it on a phone, or sending it to someone

```
node tools/bundle.mjs          # writes dist/rngdle.html
```

That inlines the CSS, the four modules and the generated EP table into one
~80 KB HTML file with **no imports, no network requests and no server**. Open it
straight off the filesystem, mail it, drop it in a chat, or put it on any static
host. It works offline once loaded, and the layout is built for phones — tap
targets are 44px+ and nothing scrolls sideways at 390px.

`dist/embed.html` is the same page as a bare fragment (style + markup + script),
for hosts that supply their own `<head>`.

**On iOS, send a link rather than the file.** Tapping an `.html` file in the Files
app opens it in Quick Look, which renders the markup but never runs JavaScript, so
the page appears but nothing responds. Chat and email previews behave the same way.
This is not something the page can fix — verified working in WebKit (Safari's own
engine) both from `file://` and over HTTP, desktop and iPhone profile, with no
console errors. Host it instead.

### A public link

The game is live at **https://nomnomsnom.github.io/factor-extractor/**, served
from the `gh-pages` branch, which holds nothing but the built page and a
`.nojekyll` marker.

`.github/workflows/rngdle-pages.yml` keeps it current: on any push to `main` that
touches `rngdle/`, it runs the tests, rebuilds the bundle and commits the result to
`gh-pages`. It publishes via that branch rather than the Actions Pages source
because a branch push auto-enables Pages, while the Actions source has to be turned
on by hand in repo settings. There is a **Run workflow** button for republishing
without a commit.

Any other static host works too — Netlify, Cloudflare Pages, or anything that
serves a file — since there is no backend.

Everything is per-device: there is no server, so no shared leaderboard. Two people
opening the same link get their own independent collections.

## The interesting part: EP is derived, not invented

The obvious way to build this is to hand-assign point values to badges and tune
until it feels right. This build doesn't do that. Instead, EP falls out of a
single formula:

```
EP = round(100 × 1,000,001 / count)
```

where `count` is exactly how many of the 1,000,001 possible rolls earn that badge.
A badge only one number in the space can earn is worth 100,000,100 EP. A coin-flip
badge like *Even* is worth 200. Nothing is tuned; **rarity is the price**.

That formula wasn't guessed. It was recovered from the live game by taking badges
whose EP values are publicly observable, computing their true frequency over the
whole roll space, and solving for the relationship:

| Badge      | True count | Derived EP | Live game EP |
|------------|-----------:|-----------:|-------------:|
| Palindrome |      1,999 |     50,025 |       50,025 |
| Prime      |     78,498 |      1,274 |        1,274 |
| Trips      |    138,033 |        724 |          724 |
| Even       |    500,001 |        200 |          200 |
| Odd        |    500,000 |        200 |          200 |
| Pair       |    831,430 |        120 |          120 |
| Six Digits |    900,000 |        111 |          111 |
| any exact  |          1 | 100,000,100| 100,000,100  |

Every one matches exactly, which also pins down two facts about the real game that
its own about-page doesn't state: the roll space is **inclusive of 1,000,000**
(1,000,001 outcomes, not 1,000,000 — the `+100` in the mythic value is the
fingerprint of that extra roll), and *Pair* means "some digit appears **at least**
twice", not exactly twice.

The practical benefit is that the formula doubles as a test oracle. Since the
predicates here were written independently, any predicate that reproduces a known
live EP value is almost certainly detecting the same thing the real game detects.
`test/engine.test.mjs` asserts that against the live game's own published badge
table, checked in at `test/fixtures/rngdle-com-badges.json`.

**Every one of the live game's 230 badges is implemented here, and every one is
priced identically to it.** Getting there meant fixing 23 predicates that were
subtly or completely wrong — *Orientation* meant "contains 101", not
"strobogrammatic"; *Echo* and *Rhyme* are substring tests, not whole-number blocks
(mispricing Echo by 300x); *Mesa* allows flat stretches anywhere, not only at the
peak — and implementing 100 badges that were missing, including the
consecutive-number family that reads 91011 as 9, 10, 11.

The supersession families are the live game's too. That matters as much as the
prices: the element badges (*Hydrogen*, *Helium*, …) are independent there, and
grouping them into a family here quietly cost three of them their payout.

The end-to-end check is a real roll. rngdle.com scored **265311** at **6,434 EP,
Uncommon, 14 badges**. So does this:

```
roll 265311 -> 6,434 EP | Uncommon | TOP 43% | 14 badges
rngdle.com  ->  6,434 EP | Uncommon | TOP 43% | 14 badges
```

## How scoring works

- **230 badges** — the live game's entire catalogue, each a pure predicate over the digits of your roll.
- **Family supersession.** Badges are grouped into families; within a family only
  your single highest-EP badge pays out. Rolling `69` earns both *Nice* and
  *Exact Nice*, but only the rarer one scores — the other is shown greyed out,
  since the rarer badge already implies it.
- **Card rarity** (Trash → Mythic) matches rngdle.com's own tier distribution,
  described below, shown alongside the percentile the live game reports
  ("TOP 43%"). That needs the whole EP distribution, which is far too big to
  ship, so `badges.gen.js` carries thresholds at every 0.1% and the page binary-
  searches them.

## Card rarity

Because every badge is priced exactly as the live game prices it, a roll scores the
same number here as there — so this uses rngdle.com's published cutoffs verbatim
rather than deriving its own:

```
Mythic 164953 · Anomaly 35744 · Epic 23077 · Rare 9644 · Uncommon 5761 · Common 2098
```

Below 2098 is *Trash*. Measured across all 1,000,001 rolls the distribution comes
out Mythic 0.98%, Anomaly 3.95%, Epic 4.92%, Common 49.34% against the live game's
1% / 4% / 5% / 49.1%. Trash runs richer here than its 0.9%, because our EP floor is
slightly coarser at the very bottom and more rolls tie below the cut.

The palette is rngdle.com's too, per tier: a saturated edge colour for borders and
glows, and a lighter fill for text, since the saturated values are unreadable on
this ground.

## Auto-roll

Auto-roll runs on `requestAnimationFrame` rather than a timer, so it never queues
work faster than the browser can paint. Three speeds:

| Speed | Behaviour |
|---|---|
| Slow | One roll every ~120ms, so you can watch each one land. |
| Fast | 25 rolls per frame. |
| Turbo | Rolls until it has spent a 10ms frame budget, then yields. |

Turbo is budgeted rather than a fixed batch size so it scales to the machine it's
on instead of locking up a slow one — on this dev box it sustains roughly 60k
rolls/sec while the page stays interactive.

Getting there needed a second entry point into the engine. `analyze(n)` allocates
an object per earned badge and sorts them, which is fine a few times a second and
hopeless a few thousand times a second. `scan(n, out)` computes the same total EP
into a caller-owned hit buffer with no per-badge allocation. `analyze()` is
implemented on top of `scan()`, so the fast path and the detailed path cannot drift
apart — and the tests assert they agree.

Speed, stop condition and roll limit are re-read every frame, so changing any of
them mid-run takes effect immediately. Long runs checkpoint to storage every few
seconds so a crashed tab doesn't cost the session.

## Layout

| File | What it is |
|---|---|
| `defs.js` | The 230 badge predicates and their families. No EP values — just rules. |
| `tools/generate.mjs` | Runs every predicate against all 1,000,001 rolls, counts hits, derives EP and the rarity cut points. |
| `badges.gen.js` | Generated output: hit counts, EP, card tiers. Do not edit by hand. |
| `engine.js` | Scoring: `analyze(n)` for detail, `scan(n, out)` for the hot path. Pure, no I/O. |
| `app.js` | UI, auto-roll loop, collection tracking, localStorage. Decides nothing about scoring. |
| `tools/bundle.mjs` | Inlines everything into a single self-contained HTML file in `dist/`. |
| `test/engine.test.mjs` | Scoring rules: the live-game EP oracle, scan/analyze parity, tier distribution. |
| `test/defaults.test.mjs` | The page's own default settings, read from the real `index.html`. |

```
node tools/generate.mjs          # regenerate badges.gen.js (~11s)
node --test "test/**/*.test.mjs" # run the tests
```

**Regenerate after touching any predicate in `defs.js`.** EP values are downstream
of the rules, so changing a rule silently invalidates the prices until you re-run
the generator. The generator also fails loudly if a badge becomes unreachable —
which is how the original `Groundhog Day` badge got caught, since a six-digit roll
can never begin with the leading zero of `02/02`.

## Differences from the original

This is a clean-room build from public descriptions of the game, not a port. The
scoring machinery and the shape of the badge catalogue match, but the badge list
here is its own thing: 169 badges against the original's ~230, with definitions
written from scratch. Badges the original defines ambiguously were either given a
crisp definition here or left out rather than guessed at.

The original is a once-a-day game. This one has no cooldown and adds auto-roll,
which turns it from a daily curiosity into a collection hunt — so the daily lock,
the UTC reset and the streak counter are gone, replaced by badges-found progress
and a best-rolls board, where any roll opens to show the badges it earned.

There is no server, so no global leaderboard. Your rolls, lifetime EP, best rolls
and collection live in `localStorage` on this device only, and nothing is
transmitted anywhere.
