// RNGdle scoring engine.
//
// analyze(n) is the whole game: it reports which badges a roll earns, how much
// EP that is worth after family supersession, and what rarity the resulting
// card is. Pure and side-effect free — the UI layer owns all persistence.

import { BADGES, FAMILY_NAMES, context, ROLL_MIN, ROLL_MAX } from './defs.js';
import { STATS, CARD_TIERS, ROLL_SPACE } from './badges.gen.js';

export { ROLL_MIN, ROLL_MAX, ROLL_SPACE, FAMILY_NAMES };

/** Badge rarity is a function of EP, which is itself a function of frequency. */
const BADGE_TIERS = [
  ['Mythic', 1e7], ['Anomaly', 1e6], ['Epic', 1e5], ['Rare', 1e4], ['Uncommon', 1e3],
];

export function badgeRarity(ep) {
  for (const [name, cut] of BADGE_TIERS) if (ep >= cut) return name;
  return 'Common';
}

export function cardRarity(totalEP) {
  for (const [name, cut] of CARD_TIERS) if (totalEP >= cut) return name;
  return 'Common';
}

/** Static catalogue: every badge with its derived cost and odds, rarest first. */
export const CATALOGUE = BADGES.map(b => {
  const [count, ep] = STATS[b.id];
  return {
    id: b.id, label: b.label, emoji: b.emoji, desc: b.desc,
    fam: b.fam, famName: b.fam ? FAMILY_NAMES[b.fam] : null,
    ep, count, chance: count / ROLL_SPACE,
    rarity: badgeRarity(ep),
  };
}).sort((a, b) => b.ep - a.ep);

const BY_ID = new Map(CATALOGUE.map(b => [b.id, b]));

/**
 * Score a single roll.
 *
 * Returns every earned badge in rarest-first order. Badges superseded by a
 * higher-EP member of the same family are still listed — they were genuinely
 * earned — but carry `scored: false` and contribute nothing to the total.
 */
export function analyze(n) {
  if (!Number.isInteger(n) || n < ROLL_MIN || n > ROLL_MAX) {
    throw new RangeError(`roll must be an integer in [${ROLL_MIN}, ${ROLL_MAX}], got ${n}`);
  }
  const c = context(n);
  const earned = [];
  for (const def of BADGES) {
    if (def.test(c)) earned.push({ ...BY_ID.get(def.id), scored: true });
  }

  // Supersession: within a family only the single highest-EP badge pays out.
  const best = new Map();
  for (const b of earned) {
    if (!b.fam) continue;
    const incumbent = best.get(b.fam);
    if (!incumbent || b.ep > incumbent.ep) best.set(b.fam, b);
  }
  for (const b of earned) {
    if (b.fam && best.get(b.fam) !== b) b.scored = false;
  }

  earned.sort((a, b) => b.ep - a.ep);
  const totalEP = earned.reduce((sum, b) => sum + (b.scored ? b.ep : 0), 0);
  return { n, badges: earned, totalEP, rarity: cardRarity(totalEP) };
}

/** A uniformly random roll, using the platform CSPRNG when one is available. */
export function roll() {
  const crypto = globalThis.crypto;
  if (crypto?.getRandomValues) {
    // Rejection sampling keeps the distribution flat across ROLL_SPACE.
    const limit = Math.floor(0x100000000 / ROLL_SPACE) * ROLL_SPACE;
    const buf = new Uint32Array(1);
    let v;
    do { crypto.getRandomValues(buf); v = buf[0]; } while (v >= limit);
    return ROLL_MIN + (v % ROLL_SPACE);
  }
  return ROLL_MIN + Math.floor(Math.random() * ROLL_SPACE);
}

/** The UTC day a roll belongs to, e.g. "2026-08-14". Rolls reset at UTC midnight. */
export function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

/** Milliseconds until the next UTC midnight, for the countdown. */
export function msUntilReset(date = new Date()) {
  const next = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
  return next - date.getTime();
}

/** Whether `b` is the day immediately after `a`, for streak bookkeeping. */
export function isNextDay(a, b) {
  if (!a) return false;
  const next = new Date(`${a}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return dayKey(next) === b;
}

/** The shareable result card, in the usual -dle clipboard format. */
export function shareText(result, day, streak) {
  const top = result.badges.filter(b => b.scored).slice(0, 5);
  const lines = [
    `RNGdle ${day}`,
    `${result.n.toLocaleString('en-US')} — ${result.rarity} · ${result.totalEP.toLocaleString('en-US')} EP`,
    top.map(b => b.emoji).join(' '),
  ];
  if (streak > 1) lines.push(`🔥 ${streak} day streak`);
  return lines.filter(Boolean).join('\n');
}
