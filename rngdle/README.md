# RNGdle

A playable remake of [RNGdle](https://www.rngdle.com/), the daily game where you
don't guess anything.

You get **one roll per UTC day**, somewhere in `0 … 1,000,000`. The game scans
your number for patterns — primes, palindromes, repeated digits, meme numbers,
straights, terrain shapes — and awards a badge for each one it finds. Every badge
is worth some EP. Rarer badges are worth dramatically more. That's the whole game:
no strategy, no second attempt, just a result to discover.

```
python3 -m http.server 8000    # then open http://localhost:8000/rngdle/
```

It needs a server rather than `file://` because the code is ES modules. There is
no build step and no dependencies — the only runtime requirement is a browser.

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
`test/engine.test.mjs` asserts that on all 13 badges whose real values are known.

## How scoring works

- **169 badges**, each a pure predicate over the digits of your roll.
- **Family supersession.** Badges are grouped into families; within a family only
  your single highest-EP badge pays out. Rolling `69` earns both *Nice* and
  *Exact Nice*, but only the rarer one scores — the other is shown greyed out,
  since the rarer badge already implies it.
- **Card rarity** (Common → Mythic) is a percentile cut on the real distribution
  of total EP, computed by scoring all 1,000,001 rolls. *Mythic* is literally the
  ten best rolls in the game; *Epic* is the top 0.1%. So the label means something
  measurable rather than something chosen.

## Layout

| File | What it is |
|---|---|
| `defs.js` | The 169 badge predicates and their families. No EP values — just rules. |
| `tools/generate.mjs` | Runs every predicate against all 1,000,001 rolls, counts hits, derives EP and the rarity cut points. |
| `badges.gen.js` | Generated output: hit counts, EP, card tiers. Do not edit by hand. |
| `engine.js` | Scoring: `analyze(n)` → badges, total EP, rarity. Pure, no I/O. |
| `app.js` | UI, daily lock, streaks, localStorage. Decides nothing about scoring. |
| `test/engine.test.mjs` | 19 tests, including the live-game EP oracle. |

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

There is no server, so no global leaderboard. Your streak, lifetime EP, and roll
history live in `localStorage` on this device only, and nothing is transmitted
anywhere. A **Practice roll** button gives you unlimited off-the-record rolls —
they never touch your stats.
