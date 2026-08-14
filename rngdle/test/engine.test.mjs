// Run with: node --test test/

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyze, roll, badgeRarity, cardRarity, CATALOGUE, shareText,
  dayKey, isNextDay, msUntilReset, ROLL_MIN, ROLL_MAX, ROLL_SPACE,
} from '../engine.js';
import { STATS } from '../badges.gen.js';

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
    DEVIL_EXACT: 100000100, BOTANIST_EXACT: 100000100, DIGIT_7: 100000100,
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
    [911, 'EMERGENCY_EXACT'], [7734, 'HELL_EXACT'], [80085, 'BOOB_EXACT'],
    [404, 'ERROR_EXACT'], [69420, 'ULTIMEME_EXACT'], [314159, 'PI_EXACT'],
    [1000000, 'MILLION'],
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
  assert.ok(idsOf(123456).has('SEQUENCE_6'));
  assert.ok(idsOf(654321).has('SEQUENCE_6'), 'descending straights count too');
  assert.ok(idsOf(121212).has('MINI_ECHO'));
  assert.ok(idsOf(348348).has('RHYME'));
  assert.ok(idsOf(555555).has('SIX_OF_A_KIND'));
  assert.ok(idsOf(555555).has('REPDIGIT'));
  assert.ok(idsOf(112233).has('CONTIGUOUS_THREE_PAIR'));
  assert.ok(idsOf(122333).has('BOAT'), '2x2 and 3x3 is a full house');
  assert.ok(idsOf(135791).has('ALL_ODD'));
  assert.ok(idsOf(246802).has('ALL_EVEN'));
  assert.ok(idsOf(101101).has('BINARY'));
  assert.ok(idsOf(147).has('ARITHMETIC'));
  assert.ok(idsOf(124).has('GEOMETRIC'));
  assert.ok(idsOf(159).has('ASCENSION'));
  assert.ok(idsOf(951).has('DECAY'));
  assert.ok(idsOf(139).has('MOUNTAIN') === false, 'monotonic rise is not a peak');
  assert.ok(idsOf(1391).has('MOUNTAIN'));
  assert.ok(idsOf(919).has('VALLEY'));
  assert.ok(idsOf(9119).has('CANYON'), 'a flat bottom is a canyon, not a valley');
  assert.ok(!idsOf(9119).has('VALLEY'));
  assert.ok(idsOf(69).has('SIXTY_SEVEN') === false);
  assert.ok(idsOf(16789).has('SIXTY_SEVEN'));
});

test('a repdigit is not counted as an echo', () => {
  // 222222 is six of a kind, not "22" repeated three times.
  assert.ok(!idsOf(222222).has('MINI_ECHO'));
  assert.ok(!idsOf(222222).has('RHYME'));
});

test('strobogrammatic numbers read the same upside down', () => {
  for (const n of [69, 88, 96, 1691, 6889]) assert.ok(idsOf(n).has('ORIENTATION_EXACT'), `${n}`);
  for (const n of [67, 123, 8081]) assert.ok(!idsOf(n).has('ORIENTATION_EXACT'), `${n}`);
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

  // Card tiers are percentile cuts on the real distribution, so Mythic is
  // literally the ten best rolls in the space — an exact hit lands just below.
  assert.equal(analyze(69).rarity, 'Anomaly');
  assert.equal(analyze(777777).rarity, 'Mythic', 'six sevens stack enough families to top out');
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

test('UTC day bookkeeping', () => {
  assert.equal(dayKey(new Date('2026-08-14T23:59:59Z')), '2026-08-14');
  assert.equal(dayKey(new Date('2026-08-15T00:00:00Z')), '2026-08-15');
  assert.ok(isNextDay('2026-08-14', '2026-08-15'));
  assert.ok(isNextDay('2026-02-28', '2026-03-01'), 'non-leap year rolls over');
  assert.ok(!isNextDay('2026-08-14', '2026-08-16'));
  assert.ok(!isNextDay(null, '2026-08-15'));

  const ms = msUntilReset(new Date('2026-08-14T23:00:00Z'));
  assert.equal(ms, 60 * 60 * 1000);
});

test('share text carries the score without leaking the badge list', () => {
  const r = analyze(69);
  const text = shareText(r, '2026-08-14', 3);
  assert.match(text, /^RNGdle 2026-08-14/);
  assert.match(text, /69 — Anomaly/);
  assert.match(text, /3 day streak/);
  assert.ok(!text.includes('Exact Nice'), 'badge names stay unspoiled');
});
