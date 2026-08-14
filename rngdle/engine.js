// RNGdle scoring engine.
//
// Two entry points over the same rules:
//   analyze(n) — full detail for one roll: every badge, its EP, the card rarity.
//   scan(n, out) — the hot path for auto-rolling: total EP plus a hit bitmap,
//                  with no per-badge object allocation.
//
// analyze() is implemented on top of scan(), so the two can never disagree.
// Pure and side-effect free — the UI layer owns all persistence.

import { BADGES, FAMILY_NAMES, context, ROLL_MIN, ROLL_MAX, ROLL_SPACE } from './defs.js';
import { STATS, CARD_TIERS } from './badges.gen.js';

export { ROLL_MIN, ROLL_MAX, ROLL_SPACE, FAMILY_NAMES };

/** Badge rarity is a function of EP, which is itself a function of frequency. */
const BADGE_TIERS = [
  ['Mythic', 1e7], ['Anomaly', 1e6], ['Epic', 1e5], ['Rare', 1e4], ['Uncommon', 1e3],
];

/** Card tiers, worst to best, for ranking comparisons. */
export const RARITY_ORDER = ['Trash', 'Common', 'Uncommon', 'Rare', 'Epic', 'Anomaly', 'Mythic'];

/** Badges have no Trash tier — the floor is Common, as in the live game. */
export function badgeRarity(ep) {
  for (const [name, cut] of BADGE_TIERS) if (ep >= cut) return name;
  return 'Common';
}

export function cardRarity(totalEP) {
  for (const [name, cut] of CARD_TIERS) if (totalEP >= cut) return name;
  return 'Trash';
}

/** The minimum total EP that reaches a given card tier. */
export function rarityFloor(name) {
  const hit = CARD_TIERS.find(([tier]) => tier === name);
  return hit ? hit[1] : 0;
}

// ---------------------------------------------------------------------------
// Index-aligned tables (defs order). Everything hot is a flat array.
// ---------------------------------------------------------------------------

export const BADGE_COUNT = BADGES.length;
export const BADGE_IDS = BADGES.map(b => b.id);

const TESTS = BADGES.map(b => b.test);
const EP_AT = Float64Array.from(BADGES, b => STATS[b.id][1]);
const SOLO_AT = Uint8Array.from(BADGES, b => (b.fam ? 0 : 1));

/** Family members as index groups, so supersession is a flat array walk. */
const FAMILY_GROUPS = (() => {
  const byName = new Map();
  BADGES.forEach((b, i) => {
    if (!b.fam) return;
    if (!byName.has(b.fam)) byName.set(b.fam, []);
    byName.get(b.fam).push(i);
  });
  return [...byName.values()];
})();

/** Static catalogue: every badge with its derived cost and odds, rarest first. */
export const CATALOGUE = BADGES.map((b, i) => {
  const [count, ep] = STATS[b.id];
  return {
    index: i,
    id: b.id, label: b.label, emoji: b.emoji, desc: b.desc,
    fam: b.fam, famName: b.fam ? FAMILY_NAMES[b.fam] : null,
    ep, count, chance: count / ROLL_SPACE,
    rarity: badgeRarity(ep),
  };
}).sort((a, b) => b.ep - a.ep);

const BY_INDEX = [];
for (const b of CATALOGUE) BY_INDEX[b.index] = b;

/** Allocate a hit buffer sized for scan(). Callers reuse one across rolls. */
export const hitBuffer = () => new Uint8Array(BADGE_COUNT);

function assertRoll(n) {
  if (!Number.isInteger(n) || n < ROLL_MIN || n > ROLL_MAX) {
    throw new RangeError(`roll must be an integer in [${ROLL_MIN}, ${ROLL_MAX}], got ${n}`);
  }
}

/**
 * Fast path. Fills `out[i] = 1` for each earned badge (defs order) and returns
 * the total EP after family supersession. Allocates nothing per badge, so this
 * is what auto-roll runs thousands of times a second.
 */
export function scan(n, out) {
  assertRoll(n);
  const c = context(n);
  out.fill(0);
  let total = 0;
  for (let i = 0; i < BADGE_COUNT; i++) {
    if (!TESTS[i](c)) continue;
    out[i] = 1;
    if (SOLO_AT[i]) total += EP_AT[i];
  }
  // Within a family only the single highest-EP badge pays out.
  for (const group of FAMILY_GROUPS) {
    let best = 0;
    for (const i of group) if (out[i] && EP_AT[i] > best) best = EP_AT[i];
    total += best;
  }
  return total;
}

/**
 * Score a single roll, in full.
 *
 * Returns every earned badge in rarest-first order. Badges superseded by a
 * higher-EP member of the same family are still listed — they were genuinely
 * earned — but carry `scored: false` and contribute nothing to the total.
 */
export function analyze(n, out = hitBuffer()) {
  const totalEP = scan(n, out);

  const earned = [];
  for (let i = 0; i < BADGE_COUNT; i++) if (out[i]) earned.push({ ...BY_INDEX[i], scored: true });

  const best = new Map();
  for (const b of earned) {
    if (!b.fam) continue;
    const incumbent = best.get(b.fam);
    if (!incumbent || b.ep > incumbent.ep) best.set(b.fam, b);
  }
  for (const b of earned) {
    if (!b.fam) continue;
    const winner = best.get(b.fam);
    if (winner === b) continue;
    b.scored = false;
    b.coveredBy = winner.label; // name the badge that took the payout, not the family
  }

  earned.sort((a, b) => b.ep - a.ep);
  return { n, badges: earned, totalEP, rarity: cardRarity(totalEP) };
}

/** A uniformly random roll, using the platform CSPRNG when one is available. */
export function roll() {
  // Some browsers expose crypto but refuse it outside a secure context, and a
  // throw here would take the whole game down. Math.random is a fine fallback
  // for a toy: fall back rather than fail.
  try {
    const crypto = globalThis.crypto;
    if (crypto?.getRandomValues) {
      // Rejection sampling keeps the distribution flat across ROLL_SPACE.
      const limit = Math.floor(0x100000000 / ROLL_SPACE) * ROLL_SPACE;
      const buf = new Uint32Array(1);
      let v;
      do { crypto.getRandomValues(buf); v = buf[0]; } while (v >= limit);
      return ROLL_MIN + (v % ROLL_SPACE);
    }
  } catch { /* fall through to Math.random */ }
  return ROLL_MIN + Math.floor(Math.random() * ROLL_SPACE);
}

/** The shareable result card, in the usual -dle clipboard format. */
export function shareText(result, stats = {}) {
  const top = result.badges.filter(b => b.scored).slice(0, 5);
  const lines = [
    'RNGdle',
    `${result.n.toLocaleString('en-US')} — ${result.rarity} · ${result.totalEP.toLocaleString('en-US')} EP`,
    top.map(b => b.emoji).join(' '),
  ];
  if (stats.rolls) lines.push(`🎲 found in ${stats.rolls.toLocaleString('en-US')} rolls`);
  if (stats.found && stats.total) lines.push(`📖 ${stats.found}/${stats.total} badges collected`);
  return lines.filter(Boolean).join('\n');
}
