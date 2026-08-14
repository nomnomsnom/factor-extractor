// Run with: node --test test/

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyze, scan, roll, hitBuffer, badgeRarity, cardRarity, rarityFloor,
  CATALOGUE, BADGE_IDS, BADGE_COUNT, RARITY_ORDER, shareText,
  ROLL_MIN, ROLL_MAX, ROLL_SPACE,
} from '../engine.js';
import { STATS } from '../badges.gen.js';
import { readFileSync } from 'node:fs';

const idsOf = n => new Set(analyze(n).badges.map(b => b.id));
const scoredIdsOf = n => new Set(analyze(n).badges.filter(b => b.scored).map(b => b.id));

test('EP matches the live game on every badge whose value is publicly known', () => {
  // These EP values are observable in the shipped game. Our predicates and EP
  // formula are derived independently, so agreeing on all of them is strong
  // evidence both the formula and these predicates are right.
  const oracle = {
    PALINDROME: 50025, PRIME: 1274, TRIPS: 724, EVEN: 200, ODD: 200,
    PAIR: 120, SIX_DIGITS: 111,
    NICE_EXACT: 100000100, JACKPOT_EXACT: 100000100, LEET_EXACT: 100000100,
    DEVIL_EXACT: 100000100, BOTANIST_EXACT: 100000100, DIGIT_SEVEN: 100000100,
    // Read off a live roll (265311). These two pinned down definitions that
    // were wrong or missing here: Mesa allows flat stretches anywhere, not just
    // a flat top, and Snake Eyes did not exist at all.
    SNAKE_EYES: 2121, MESA: 1568,
  };
  for (const [id, ep] of Object.entries(oracle)) {
    assert.equal(STATS[id]?.[1], ep, `${id} EP`);
  }
});

test('EP is exactly the derived price of rarity', () => {
  for (const b of CATALOGUE) {
    assert.equal(b.ep, Math.round((100 * ROLL_SPACE) / b.count), `${b.id} EP vs count`);
  }
});

test('every badge is reachable and no badge is universal', () => {
  for (const b of CATALOGUE) {
    assert.ok(b.count > 0, `${b.id} is unreachable`);
    assert.ok(b.count < ROLL_SPACE, `${b.id} is earned by every roll`);
  }
});

test('badge ids are unique', () => {
  assert.equal(new Set(CATALOGUE.map(b => b.id)).size, CATALOGUE.length);
});

test('exact meme numbers earn their exact badge', () => {
  const cases = [
    [69, 'NICE_EXACT'], [420, 'BOTANIST_EXACT'], [666, 'DEVIL_EXACT'],
    [777, 'JACKPOT_EXACT'], [1337, 'LEET_EXACT'], [42, 'MEANING_EXACT'],
    [911, 'EMERGENCY_EXACT'], [7734, 'EXACT_HELL'], [80085, 'EXACT_BOOB_80085'],
    [404, 'ERROR_EXACT'], [69420, 'ULTIMEME_EXACT'], [42069, 'ULTIMEME_EXACT'],
    [314159, 'PI'], [271828, 'E'], [628318, 'TAU'], [666666, 'INFERNAL'],
    [17776, 'FOOTBALL_17776'], [1000000, 'ONE_MILLION'], [101, 'ORIENTATION_EXACT'],
    [365, 'CALENDAR_EXACT'], [365365, 'GROUNDHOG_DAY'],
  ];
  for (const [n, id] of cases) assert.ok(idsOf(n).has(id), `${n} should earn ${id}`);
});

test('family supersession pays only the best member', () => {
  const r = analyze(69);
  const ids = new Set(r.badges.map(b => b.id));
  assert.ok(ids.has('NICE_EXACT') && ids.has('NICE'), 'both NICE badges are earned');

  const nice = r.badges.find(b => b.id === 'NICE');
  const exact = r.badges.find(b => b.id === 'NICE_EXACT');
  assert.equal(exact.scored, true, 'the rarer badge scores');
  assert.equal(nice.scored, false, 'the implied badge does not');

  // Nothing outside the scored set contributes.
  const expected = r.badges.filter(b => b.scored).reduce((s, b) => s + b.ep, 0);
  assert.equal(r.totalEP, expected);

  // A superseded badge names the badge that took its payout, so the UI can say
  // "covered by Exact Nice" rather than the useless "covered by Nice".
  assert.equal(nice.coveredBy, 'Exact Nice');
  assert.equal(exact.coveredBy, undefined);
});

test('every superseded badge names its winner, on a broad sample', () => {
  for (let n = 0; n <= ROLL_MAX; n += 8117) {
    for (const b of analyze(n).badges) {
      if (b.scored) continue;
      assert.ok(b.coveredBy, `roll ${n}: ${b.id} superseded with no winner named`);
      assert.notEqual(b.coveredBy, b.label, `roll ${n}: ${b.id} covered by itself`);
    }
  }
});

test('at most one badge per family scores, on every roll in a broad sample', () => {
  for (let n = 0; n <= ROLL_MAX; n += 9973) { // coprime stride: sweeps the space
    const seen = new Set();
    for (const b of analyze(n).badges) {
      if (!b.scored || !b.fam) continue;
      assert.ok(!seen.has(b.fam), `roll ${n} double-scored family ${b.fam}`);
      seen.add(b.fam);
    }
  }
});

test('digit patterns are detected', () => {
  assert.ok(idsOf(12321).has('PALINDROME'));
  assert.ok(idsOf(123456).has('CASCADE'), 'each digit one more than the last');
  assert.ok(idsOf(654321).has('WATERFALL'));
  assert.ok(idsOf(121212).has('MINI_ECHO'));
  assert.ok(idsOf(348348).has('RHYME'));
  assert.ok(idsOf(555555).has('HOMOGENEOUS'));
  assert.ok(idsOf(555555).has('FIVE_OF_A_KIND'), 'five of a kind counts six too');
  assert.ok(idsOf(112233).has('CONTIGUOUS_THREE_PAIR'));
  assert.ok(idsOf(122333).has('BOAT'), 'a set of three and a set of two');
  assert.ok(idsOf(135791).has('FLUSH'), 'all odd digits');
  assert.ok(idsOf(246802).has('FLUSH'), 'all even digits');
  assert.ok(idsOf(101101).has('BINARY_SOUL'));
  assert.ok(idsOf(159).has('ASCENSION'));
  assert.ok(idsOf(951).has('DECAY'));
  assert.ok(!idsOf(139).has('MOUNTAIN'), 'a monotonic rise never falls');
  assert.ok(idsOf(1391).has('MOUNTAIN'));
  assert.ok(idsOf(919).has('VALLEY'));
  assert.ok(idsOf(9119).has('CANYON'), 'a flat bottom still descends then rises');
  assert.ok(idsOf(265311).has('MESA'), 'a flat stretch after the fall still counts');
  assert.ok(idsOf(1391).has('MESA'), 'a strict peak is a mesa too');
  assert.ok(!idsOf(123456).has('MESA'), 'a pure climb never falls');
  assert.ok(idsOf(265311).has('SNAKE_EYES'));
  assert.ok(idsOf(16789).has('SIXTY_SEVEN'));
  assert.ok(!idsOf(69).has('SIXTY_SEVEN'));
});

test('consecutive numbers written end to end', () => {
  // The live game reads 91011 as 9, 10, 11. A plain digit run does not count:
  // at least one part must have two or more digits.
  assert.ok(idsOf(91011).has('CONSEC_TRIPLE_EXACT'));
  assert.ok(!idsOf(123).has('CONSEC_TRIPLE_EXACT'), 'single digits alone do not qualify');
  assert.ok(idsOf(1112).has('CONSEC_PAIR_EXACT'), '11 then 12');
  assert.ok(idsOf(78910).has('CONSEC_QUAD_EXACT'), '7, 8, 9, 10');
});

test('repeat badges match the live game\'s wording', () => {
  // Echo is "contains an adjacent 2-digit repeat" and Rhyme is "contains the
  // same 2+ digit substring twice" — both are about substrings, so a repdigit
  // qualifies. An earlier build read them as whole-number blocks and mispriced
  // Echo by a factor of 300.
  assert.ok(idsOf(222222).has('MINI_ECHO'), '2222 is an adjacent 2-digit repeat');
  assert.ok(idsOf(222222).has('RHYME'));
  assert.ok(idsOf(923231).has('MINI_ECHO'), 'the echo need not start the number');
  assert.ok(idsOf(348348).has('RHYME'));
  assert.ok(!idsOf(123456).has('RHYME'), 'no substring occurs twice');
});

test('Orientation is the course number, not a rotation', () => {
  // This one was pure invention here: it used to mean "strobogrammatic". The
  // live game means the string "101".
  assert.ok(idsOf(101).has('ORIENTATION_EXACT'));
  assert.ok(idsOf(101).has('ORIENTATION'));
  assert.ok(idsOf(410123).has('ORIENTATION'));
  assert.ok(!idsOf(410123).has('ORIENTATION_EXACT'));
  assert.ok(!idsOf(69).has('ORIENTATION'));
});

test('0 and 1 count as perfect powers of every exponent', () => {
  for (const n of [0, 1]) {
    const ids = idsOf(n);
    for (const id of ['SQUARE', 'CUBE', 'FOURTH_POWER', 'TENTH_POWER']) {
      assert.ok(ids.has(id), `${n} should be a ${id}`);
    }
  }
});

test('rarer rolls are worth more than plain ones', () => {
  assert.ok(analyze(69).totalEP > analyze(438251).totalEP, 'a meme number beats a nothing number');
  assert.ok(analyze(777777).totalEP > analyze(777771).totalEP, 'six sevens beat five');
  assert.ok(analyze(123456).totalEP > analyze(123458).totalEP, 'a full straight beats a near miss');

  assert.equal(analyze(69).rarity, 'Mythic', 'an exact meme hit tops the table');
  assert.equal(analyze(777777).rarity, 'Mythic', 'six sevens stack enough families to top out');
});

test('card tiers are rngdle.com\'s published cutoffs', () => {
  // Every badge is now priced exactly as the live game prices it, so a roll
  // scores the same number here as there and the real cutoffs apply directly.
  const published = [['Mythic', 164953], ['Anomaly', 35744], ['Epic', 23077],
                     ['Rare', 9644], ['Uncommon', 5761], ['Common', 2098]];
  for (const [tier, cut] of published) {
    assert.equal(rarityFloor(tier), cut, `${tier} cutoff`);
    assert.equal(cardRarity(cut), tier, `${tier} floor lands in ${tier}`);
    assert.equal(cardRarity(cut - 1) === tier, false, `just below ${tier} is a lower tier`);
  }
  assert.equal(cardRarity(0), 'Trash');
});

test('the rarity distribution tracks the live game', () => {
  const seen = Object.fromEntries(RARITY_ORDER.map(r => [r, 0]));
  const buf = hitBuffer();
  for (let n = 0; n <= ROLL_MAX; n++) seen[cardRarity(scan(n, buf))]++;
  const share = t => (seen[t] / ROLL_SPACE) * 100;

  // The top tiers land on the real shares almost exactly.
  for (const [tier, want] of [['Mythic', 1], ['Anomaly', 4], ['Epic', 5], ['Common', 49.1]]) {
    assert.ok(Math.abs(share(tier) - want) < 0.5, `${tier}: ${share(tier).toFixed(2)}%, want ~${want}%`);
  }
  // Trash runs richer than the live game's 0.9%: our EP floor is coarser at the
  // very bottom, so more rolls tie below the 2098 cut. Guard the magnitude so a
  // regression that floods Trash still fails.
  assert.ok(share('Trash') < 10, `Trash at ${share('Trash').toFixed(2)}%`);
});

test('every tier is reachable and Trash is the floor', () => {
  assert.equal(cardRarity(0), 'Trash');
  const buf = hitBuffer();
  const seen = new Set();
  for (let n = 0; n <= ROLL_MAX; n += 101) seen.add(cardRarity(scan(n, buf)));
  for (const tier of RARITY_ORDER) assert.ok(seen.has(tier), `${tier} never occurs`);
});

test('rarity tiers are ordered and total EP is never negative', () => {
  for (let n = 0; n <= ROLL_MAX; n += 7919) {
    const r = analyze(n);
    assert.ok(r.totalEP >= 0, `roll ${n}`);
    assert.ok(typeof r.rarity === 'string' && r.rarity.length > 0);
  }
});

test('badgeRarity brackets on EP', () => {
  assert.equal(badgeRarity(100000100), 'Mythic');
  assert.equal(badgeRarity(1e7), 'Mythic');
  assert.equal(badgeRarity(1e6), 'Anomaly');
  assert.equal(badgeRarity(1e5), 'Epic');
  assert.equal(badgeRarity(1e4), 'Rare');
  assert.equal(badgeRarity(1e3), 'Uncommon');
  assert.equal(badgeRarity(999), 'Common');
});

test('analyze rejects rolls outside the space', () => {
  for (const bad of [-1, ROLL_MAX + 1, 1.5, NaN, '69']) {
    assert.throws(() => analyze(bad), RangeError, `${bad}`);
  }
});

test('roll() stays in range and covers the space', () => {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 20000; i++) {
    const n = roll();
    assert.ok(Number.isInteger(n) && n >= ROLL_MIN && n <= ROLL_MAX);
    lo = Math.min(lo, n); hi = Math.max(hi, n);
  }
  assert.ok(lo < ROLL_SPACE * 0.02, 'samples reach the low end');
  assert.ok(hi > ROLL_SPACE * 0.98, 'samples reach the high end');
});

test('every roll earns at least one badge', () => {
  for (let n = 0; n <= ROLL_MAX; n += 4001) {
    assert.ok(analyze(n).badges.length > 0, `roll ${n} earned nothing`);
  }
});

test('share text carries the score without leaking the badge list', () => {
  const text = shareText(analyze(69), { rolls: 1234, found: 40, total: BADGE_COUNT });
  assert.match(text, /^RNGdle/);
  assert.match(text, /69 — Mythic/);
  assert.match(text, /1,234 rolls/);
  assert.match(text, new RegExp(`40/${BADGE_COUNT} badges`));
  assert.ok(!text.includes('Exact Nice'), 'badge names stay unspoiled');
});

// --- the auto-roll fast path -----------------------------------------------

test('scan agrees with analyze on total EP across the space', () => {
  const buf = hitBuffer();
  for (let n = 0; n <= ROLL_MAX; n += 6421) {
    assert.equal(scan(n, buf), analyze(n).totalEP, `roll ${n}`);
  }
});

test('scan reports exactly the badges analyze reports', () => {
  const buf = hitBuffer();
  for (const n of [0, 69, 777777, 123456, 428193, 1000000]) {
    scan(n, buf);
    const fromScan = new Set(BADGE_IDS.filter((_, i) => buf[i]));
    const fromAnalyze = new Set(analyze(n).badges.map(b => b.id));
    assert.deepEqual(fromScan, fromAnalyze, `roll ${n}`);
  }
});

test('scan clears stale hits when a buffer is reused', () => {
  // The whole point of the buffer is reuse; a leftover 1 would corrupt the
  // caller's collection tracking on every subsequent roll.
  const buf = hitBuffer();
  scan(777777, buf);
  assert.ok(buf.some(v => v === 1));
  scan(428193, buf);
  const leftover = BADGE_IDS.filter((_, i) => buf[i]);
  assert.deepEqual(new Set(leftover), new Set(analyze(428193).badges.map(b => b.id)));
});

test('analyze does not depend on the buffer it is handed', () => {
  const dirty = hitBuffer().fill(1);
  assert.equal(analyze(69, dirty).totalEP, analyze(69).totalEP);
});

test('badge index tables line up with the catalogue', () => {
  assert.equal(BADGE_IDS.length, BADGE_COUNT);
  assert.equal(CATALOGUE.length, BADGE_COUNT);
  for (const b of CATALOGUE) assert.equal(BADGE_IDS[b.index], b.id, `${b.id} index`);
});

test('rarity ordering is usable as a stop condition', () => {
  assert.deepEqual(RARITY_ORDER,
    ['Trash', 'Common', 'Uncommon', 'Rare', 'Epic', 'Anomaly', 'Mythic']);
  for (let i = 1; i < RARITY_ORDER.length; i++) {
    assert.ok(rarityFloor(RARITY_ORDER[i]) > rarityFloor(RARITY_ORDER[i - 1]),
      `${RARITY_ORDER[i]} floor should exceed ${RARITY_ORDER[i - 1]}`);
  }
  // A roll at a tier's floor must actually report that tier.
  for (const name of RARITY_ORDER.slice(1)) {
    assert.equal(cardRarity(rarityFloor(name)), name, `${name} floor`);
  }
});

test('scan rejects rolls outside the space', () => {
  const buf = hitBuffer();
  for (const bad of [-1, ROLL_MAX + 1, 1.5, NaN]) {
    assert.throws(() => scan(bad, buf), RangeError, `${bad}`);
  }
});

// --- parity with the live game ----------------------------------------------

test('every shared badge is priced exactly as rngdle.com prices it', () => {
  // fixtures/rngdle-com-badges.json is the live game's own published table
  // (id, label, description, EP) for all 203 of its badges. Any badge we
  // implement under a shared id must agree on EP to the unit — and since EP is
  // derived here purely from measured frequency, agreement means the predicate
  // detects exactly what theirs detects.
  const real = JSON.parse(
    readFileSync(new URL('./fixtures/rngdle-com-badges.json', import.meta.url), 'utf8'));
  const byId = new Map(real.map(b => [b.id, b]));

  const shared = CATALOGUE.filter(b => byId.has(b.id));
  assert.ok(shared.length > 100, `expected a large overlap, got ${shared.length}`);

  const wrong = shared
    .filter(b => b.ep !== byId.get(b.id).ep)
    .map(b => `${b.id}: ours ${b.ep}, theirs ${byId.get(b.id).ep} ("${byId.get(b.id).desc}")`);
  assert.deepEqual(wrong, [], `${wrong.length} badge(s) mispriced against the live game`);
});
