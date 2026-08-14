// Run with: node --test test/

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyze, scan, roll, hitBuffer, badgeRarity, cardRarity, rarityFloor,
  CATALOGUE, BADGE_IDS, BADGE_COUNT, RARITY_ORDER, shareText,
  ROLL_MIN, ROLL_MAX, ROLL_SPACE,
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

  assert.equal(analyze(69).rarity, 'Mythic', 'an exact meme hit tops the table');
  assert.equal(analyze(777777).rarity, 'Mythic', 'six sevens stack enough families to top out');
});

test('card tiers reproduce rngdle.com\'s rarity distribution', () => {
  // The live game's tiers are Mythic 1% / Anomaly 4% / Epic 5% / Rare 15% /
  // Uncommon 25% / Common ~49% / Trash ~0.9%, recovered from its published
  // EP->percentile table. It states them as fixed EP cutoffs, but those are
  // specific to its 230-badge set; what actually defines a tier is its share.
  // This sweeps the whole roll space and checks our shares match the game's.
  const TARGET = { Mythic: 1, Anomaly: 4, Epic: 5, Rare: 15, Uncommon: 25 };

  const seen = Object.fromEntries(RARITY_ORDER.map(r => [r, 0]));
  const buf = hitBuffer();
  let floor = Infinity, floorCount = 0, nextUp = Infinity;
  const totals = new Float64Array(ROLL_SPACE);
  for (let n = 0; n <= ROLL_MAX; n++) {
    const ep = scan(n, buf);
    totals[n] = ep;
    seen[cardRarity(ep)]++;
    if (ep < floor) floor = ep;
  }
  for (const ep of totals) {
    if (ep === floor) floorCount++;
    else if (ep < nextUp) nextUp = ep; // the next total a roll can actually reach
  }
  const share = tier => (seen[tier] / ROLL_SPACE) * 100;

  for (const [tier, want] of Object.entries(TARGET)) {
    // Total EP is lumpy — badges come in discrete jumps — so a quantile cut
    // cannot land on a share to the decimal. Half a point is close enough that
    // the tier means the same thing it does in the real game.
    assert.ok(Math.abs(share(tier) - want) < 0.5,
      `${tier}: ${share(tier).toFixed(2)}% of rolls, want ~${want}%`);
  }

  // The real game's bottom half is Common + Trash (49.1% + 0.9%). Per-tier
  // rounding accumulates here — a tie sitting on the Uncommon cut pushes that
  // tier to 25.5%, and the bottom half absorbs the difference — so this gets a
  // wider tolerance than the individual tiers rather than a tighter one.
  assert.ok(Math.abs(share('Common') + share('Trash') - 50) < 1,
    `bottom half is ${(share('Common') + share('Trash')).toFixed(2)}%, want ~50%`);

  // Trash cannot be a percentile here: the floor is one big tie, so it is
  // defined as the floor itself rather than an arbitrary cut through it.
  assert.equal(seen.Trash, floorCount,
    'Trash should be exactly the rolls scoring the minimum possible EP');
  assert.equal(cardRarity(floor), 'Trash');
  assert.notEqual(cardRarity(nextUp), 'Trash',
    `the next reachable total (${nextUp}) should already be Common`);
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
