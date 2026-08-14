// RNGdle badge definitions.
//
// Every badge is a pure predicate over a roll context. No EP values live here:
// EP is *derived* from each badge's exact frequency over the whole roll space by
// tools/generate.mjs, using the formula documented in README.md. That keeps the
// rarity economy self-consistent — a badge is worth exactly what it is rare.
//
// A badge may declare a `fam`. Within a family only the single highest-EP earned
// badge scores; the others are still shown as earned but contribute 0, because
// the higher tier already implies them (Exact Nice implies Nice).

export const ROLL_MIN = 0;
export const ROLL_MAX = 1000000;
export const ROLL_SPACE = ROLL_MAX - ROLL_MIN + 1; // 1,000,001

// ---------------------------------------------------------------------------
// Precomputed number sets
// ---------------------------------------------------------------------------

const SIEVE = (() => {
  const s = new Uint8Array(ROLL_MAX + 1).fill(1);
  s[0] = s[1] = 0;
  for (let i = 2; i * i <= ROLL_MAX; i++) {
    if (!s[i]) continue;
    for (let j = i * i; j <= ROLL_MAX; j += i) s[j] = 0;
  }
  return s;
})();

const isPrime = n => SIEVE[n] === 1;

// Perfect k-th powers up to ROLL_MAX. 0 and 1 are perfect powers of every
// exponent, so they show up in all of these.
const powerSet = k => {
  const set = new Set([0, 1]);
  for (let base = 2; base ** k <= ROLL_MAX; base++) set.add(base ** k);
  return set;
};
const POWERS = {};
for (let k = 2; k <= 19; k++) POWERS[k] = powerSet(k);

// Powers of a fixed base (1, b, b^2, ...) — distinct from perfect powers.
const baseSet = b => {
  const set = new Set();
  for (let v = 1; v <= ROLL_MAX; v *= b) set.add(v);
  return set;
};
const POW2 = baseSet(2), POW3 = baseSet(3), POW5 = baseSet(5);
const POW7 = baseSet(7), POW10 = baseSet(10);

const FIB = (() => {
  const set = new Set([0, 1]);
  let a = 0, b = 1;
  while (b <= ROLL_MAX) { set.add(b); [a, b] = [b, a + b]; }
  return set;
})();

const TRIANGULAR = (() => {
  const set = new Set();
  for (let i = 1, t = 1; t <= ROLL_MAX; i++, t += i) set.add(t);
  return set;
})();

const FACTORIAL = (() => {
  const set = new Set();
  for (let i = 1, f = 1; f <= ROLL_MAX; i++, f *= i) set.add(f);
  return set;
})();

// Repunits (1, 11, 111, ...) and repdigits (any digit repeated).
const REPDIGIT = (() => {
  const set = new Set();
  for (let d = 1; d <= 9; d++) {
    let v = 0;
    for (let len = 1; len <= 7; len++) {
      v = v * 10 + d;
      if (v <= ROLL_MAX) set.add(v);
    }
  }
  return set;
})();

// Numbers of the form n^n.
const OUROBOROS = (() => {
  const set = new Set();
  for (let n = 1; n ** n <= ROLL_MAX; n++) set.add(n ** n);
  return set;
})();

// Pronic numbers: k * (k + 1).
const PRONIC = (() => {
  const set = new Set();
  for (let k = 0; k * (k + 1) <= ROLL_MAX; k++) set.add(k * (k + 1));
  return set;
})();

// Digits that survive a 180-degree rotation, and what they become.
const FLIP = { 0: '0', 1: '1', 6: '9', 8: '8', 9: '6' };

// Perfect numbers (equal to the sum of their proper divisors) below 1e6.
const PERFECT = new Set([6, 28, 496, 8128]);

// ---------------------------------------------------------------------------
// Roll context
// ---------------------------------------------------------------------------

/**
 * Build the shared analysis context for one roll. Every predicate reads from
 * this, so each derived quantity is computed once per number rather than once
 * per badge.
 */
export function context(n) {
  const s = String(n);
  const len = s.length;
  const d = new Array(len);
  const counts = new Uint8Array(10);
  let sum = 0, prod = 1;
  for (let i = 0; i < len; i++) {
    const v = s.charCodeAt(i) - 48;
    d[i] = v;
    counts[v]++;
    sum += v;
    prod *= v;
  }
  let distinct = 0, maxCount = 0;
  for (let v = 0; v < 10; v++) {
    if (!counts[v]) continue;
    distinct++;
    if (counts[v] > maxCount) maxCount = counts[v];
  }
  // Run-length encoding of adjacent equal digits, e.g. 445556 -> [2,3,1].
  const runs = [];
  for (let i = 0; i < len;) {
    let j = i;
    while (j < len && d[j] === d[i]) j++;
    runs.push(j - i);
    i = j;
  }
  return { n, s, len, d, counts, distinct, sum, prod, maxCount, runs };
}

// ---------------------------------------------------------------------------
// Predicate helpers
// ---------------------------------------------------------------------------

/** How many distinct digits occur exactly k times. */
const exactly = (c, k) => {
  let out = 0;
  for (let v = 0; v < 10; v++) if (c.counts[v] === k) out++;
  return out;
};

/** How many distinct digits occur at least k times. */
const atLeast = (c, k) => {
  let out = 0;
  for (let v = 0; v < 10; v++) if (c.counts[v] >= k) out++;
  return out;
};

/** How many runs of adjacent identical digits are exactly k long. */
const runsOfLength = (c, k) => {
  let out = 0;
  for (const r of c.runs) if (r === k) out++;
  return out;
};

/** Some run of `a` or more sits immediately beside a run of `b` or more. */
const adjacentRuns = (c, a, b) => {
  for (let i = 0; i + 1 < c.runs.length; i++) {
    const p = c.runs[i], q = c.runs[i + 1];
    if ((p >= a && q >= b) || (p >= b && q >= a)) return true;
  }
  return false;
};

/**
 * Two digits that each appear exactly twice, contiguously, sitting back to
 * back — the `aabb` shape.
 */
const adjacentPairBlocks = c => {
  const starts = [];
  for (let v = 0; v < 10; v++) {
    if (c.counts[v] !== 2) continue;
    for (let i = 0; i + 1 < c.len; i++) {
      if (c.d[i] === v && c.d[i + 1] === v) { starts.push(i); break; }
    }
  }
  if (starts.length < 2) return false;
  starts.sort((x, y) => x - y);
  for (let i = 0; i + 1 < starts.length; i++) if (starts[i] + 2 === starts[i + 1]) return true;
  return false;
};

/** Strictly increasing or strictly decreasing across the whole number. */
const strictlyMonotonic = (c, up) => {
  if (c.len < 2) return false;
  for (let i = 1; i < c.len; i++) {
    if (up ? c.d[i] <= c.d[i - 1] : c.d[i] >= c.d[i - 1]) return false;
  }
  return true;
};

/**
 * A digit sits at two positions two apart, and that every-other run stops at
 * two — no third hop before or after it.
 */
const isHopscotch = c => {
  if (c.len < 3 || c.distinct < 2) return false;
  for (let i = 0; i + 2 < c.len; i++) {
    if (c.d[i] !== c.d[i + 2]) continue;
    const carriesOn = i + 4 < c.len && c.d[i + 4] === c.d[i];
    const cameFrom = i >= 2 && c.d[i - 2] === c.d[i];
    if (!carriesOn && !cameFrom) return true;
  }
  return false;
};

/** Some substring of `min` or more digits occurs twice without overlapping. */
const repeatsSubstring = (c, min) => {
  for (let len = min; len <= c.len >> 1; len++) {
    for (let i = 0; i + len <= c.len; i++) {
      if (c.s.indexOf(c.s.slice(i, i + len), i + len) !== -1) return true;
    }
  }
  return false;
};

/** A two-digit block immediately repeated, e.g. the 2323 inside 923231. */
const hasAdjacentEcho = c => {
  for (let i = 0; i + 4 <= c.len; i++) {
    if (c.s.slice(i, i + 2) === c.s.slice(i + 2, i + 4)) return true;
  }
  return false;
};

/**
 * Split the digit string into exactly `count` parts (no part may carry a
 * leading zero) and test the resulting numbers. Returns the first match.
 */
const splitParts = (str, count, pred) => {
  const nums = new Array(count);
  const rec = (idx, start) => {
    if (idx === count - 1) {
      const part = str.slice(start);
      if (!part || (part.length > 1 && part[0] === '0')) return false;
      nums[idx] = Number(part);
      return pred(nums);
    }
    for (let end = start + 1; end <= str.length - (count - idx - 1); end++) {
      const part = str.slice(start, end);
      if (part.length > 1 && part[0] === '0') continue;
      nums[idx] = Number(part);
      if (rec(idx + 1, end)) return true;
    }
    return false;
  };
  return rec(0, 0) ? [...nums] : null;
};

/** As above, trying every part count from three upwards. */
const splitMatches = (str, pred) => {
  for (let count = 3; count <= str.length; count++) if (splitParts(str, count, pred)) return true;
  return false;
};


// --- Consecutive-integer helpers -------------------------------------------
// The live game reads a roll as several whole numbers laid end to end, e.g.
// 91011 as 9, 10, 11. A split is only considered when no part carries a leading
// zero and at least one part has two or more digits, so a plain digit run like
// "123" does not qualify.

const leadingZero = p => p.length > 1 && p[0] === '0';
const multiPart = parts => parts.some(p => p.length >= 2);

/** The numbers, sorted, form a run with no gaps. */
const consecutiveSet = nums => {
  const a = [...nums].sort((x, y) => x - y);
  for (let i = 1; i < a.length; i++) if (a[i] !== a[i - 1] + 1) return false;
  return true;
};

/** Strictly ascending or strictly descending as written. */
const inSequence = nums => {
  let up = true, down = true;
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] <= nums[i - 1]) up = false;
    if (nums[i] >= nums[i - 1]) down = false;
  }
  return up || down;
};

/** Split the whole roll into `count` consecutive numbers, in any order. */
const wholeSplitConsecutive = (s, count) => {
  const cuts = new Array(count - 1);
  const walk = (idx, start) => {
    if (idx === count - 1) {
      const parts = [];
      let prev = 0;
      for (const cut of cuts) { parts.push(s.slice(prev, cut)); prev = cut; }
      parts.push(s.slice(prev));
      if (parts.some(p => !p || leadingZero(p)) || !multiPart(parts)) return null;
      const nums = parts.map(Number);
      return consecutiveSet(nums) ? nums : null;
    }
    for (let end = start + 1; end <= s.length - (count - 1 - idx); end++) {
      cuts[idx] = end;
      const hit = walk(idx + 1, end);
      if (hit) return hit;
    }
    return null;
  };
  return walk(0, 0);
};

/** A run of `count` consecutive numbers written back to back inside the roll. */
const runFrom = (s, start, len, dir, count) => {
  const parts = [s.slice(start, start + len)];
  let pos = start + len, cur = Number(parts[0]);
  for (let k = 1; k < count; k++) {
    const next = cur + dir;
    if (next < 0) return null;
    const text = String(next);
    if (pos + text.length > s.length || s.slice(pos, pos + text.length) !== text) return null;
    parts.push(text);
    pos += text.length;
    cur = next;
  }
  return multiPart(parts) ? { start, end: pos } : null;
};

/** Same, anywhere inside the roll — but a run spanning the whole roll is the
 *  "exact" badge's job, not this one. */
const containsRun = (s, count) => {
  for (let start = 0; start < s.length; start++) {
    for (let len = 1; len <= s.length - start - (count - 1); len++) {
      const head = s.slice(start, start + len);
      if (leadingZero(head)) continue;
      const hit = runFrom(s, start, len, 1, count) || runFrom(s, start, len, -1, count);
      if (hit && !(hit.start === 0 && hit.end === s.length)) return true;
    }
  }
  return false;
};

/** Two consecutive numbers sitting apart from each other in the roll. */
const nearbyConsecutivePair = s => {
  const subs = [];
  for (let i = 0; i < s.length; i++) {
    for (let len = 1; i + len <= s.length; len++) {
      const text = s.slice(i, i + len);
      if (!leadingZero(text)) subs.push({ v: Number(text), from: i, to: i + len, text });
    }
  }
  for (let a = 0; a < subs.length; a++) {
    for (let b = a + 1; b < subs.length; b++) {
      const x = subs[a], y = subs[b];
      if (Math.abs(x.v - y.v) !== 1 || !multiPart([x.text, y.text])) continue;
      if ((x.to <= y.from || y.to <= x.from) && x.to !== y.from && y.to !== x.from) return true;
    }
  }
  return false;
};

/** Longest run of adjacent identical digits. */
const longestRun = c => Math.max(...c.runs);

/** Longest contiguous stretch of consecutive digits, ascending or descending. */
const longestLadder = c => {
  let best = 1, up = 1, down = 1;
  for (let i = 1; i < c.len; i++) {
    up = c.d[i] === c.d[i - 1] + 1 ? up + 1 : 1;
    down = c.d[i] === c.d[i - 1] - 1 ? down + 1 : 1;
    best = Math.max(best, up, down);
  }
  return best;
};

/** True when the digits, sorted, form a run of consecutive values. */
const isScramble = c => {
  if (c.len < 2 || c.distinct !== c.len) return false;
  const sorted = [...c.d].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) if (sorted[i] !== sorted[i - 1] + 1) return false;
  return true;
};

/** Digits form an arithmetic progression with a non-zero common difference. */
const isArithmetic = c => {
  if (c.len < 3) return false;
  const step = c.d[1] - c.d[0];
  if (step === 0) return false;
  for (let i = 2; i < c.len; i++) if (c.d[i] - c.d[i - 1] !== step) return false;
  return true;
};

/** Digits form a geometric progression with an integer ratio of 2 or more. */
const isGeometric = c => {
  if (c.len < 3 || c.d[0] === 0) return false;
  const ratio = c.d[1] / c.d[0];
  if (!Number.isInteger(ratio) || ratio < 2) return false;
  for (let i = 2; i < c.len; i++) if (c.d[i] !== c.d[i - 1] * ratio) return false;
  return true;
};

/** Strictly rises to a single peak then strictly falls (or the inverse). */
const isPeak = (c, up) => {
  if (c.len < 3) return false;
  let i = 1;
  while (i < c.len && (up ? c.d[i] > c.d[i - 1] : c.d[i] < c.d[i - 1])) i++;
  if (i === 1 || i === c.len) return false; // never turned, or never rose
  for (let j = i; j < c.len; j++) {
    if (up ? c.d[j] >= c.d[j - 1] : c.d[j] <= c.d[j - 1]) return false;
  }
  return true;
};

/**
 * Rises to a peak then falls (or the inverse) with flat stretches allowed
 * anywhere — not just at the top. A superset of the strict peak above, so the
 * strict version supersedes it inside the terrain family.
 *
 * Pinned by the live game: it prices Mesa at 1,568 EP, which back-solves to
 * 63,762 matching rolls, and only this reading produces that count.
 */
const isTerrace = (c, up) => {
  const n = c.len;
  if (n < 3) return false;
  let i = 1;
  while (i < n && (up ? c.d[i] >= c.d[i - 1] : c.d[i] <= c.d[i - 1])) i++;
  if (i === 1 || i === n) return false; // never turned, or never came back
  for (let j = i; j < n; j++) {
    if (up ? c.d[j] > c.d[j - 1] : c.d[j] < c.d[j - 1]) return false;
  }
  // A flat run alone is not a climb; require at least one real step up.
  for (let k = 1; k < i; k++) {
    if (up ? c.d[k] > c.d[k - 1] : c.d[k] < c.d[k - 1]) return true;
  }
  return false;
};

/** Monotonic across the whole number. `strict` forbids equal neighbours. */
const monotonic = (c, up, strict) => {
  if (c.len < 3) return false;
  let flat = false;
  for (let i = 1; i < c.len; i++) {
    const a = c.d[i - 1], b = c.d[i];
    if (a === b) { flat = true; continue; }
    if (up ? b < a : b > a) return false;
  }
  return strict ? !flat : flat;
};

const isPalindrome = s => {
  for (let i = 0, j = s.length - 1; i < j; i++, j--) if (s[i] !== s[j]) return false;
  return true;
};

/** Any substring of the given length is a palindrome. */
const hasPalindromeOfLength = (c, k) => {
  for (let i = 0; i + k <= c.len; i++) if (isPalindrome(c.s.slice(i, i + k))) return true;
  return false;
};

const digitsIn = (c, set) => c.d.every(v => set.has(v));

// ---------------------------------------------------------------------------
// Badge catalogue
// ---------------------------------------------------------------------------

/** An exact-value badge: the rarest thing in the game, one number each. */
const exact = (id, label, emoji, value, fam, desc) =>
  ({ id, label, emoji, fam, desc: desc || `Rolled exactly ${value}.`, test: c => c.n === value });

export const BADGES = [
  // --- Exact hits: meme numbers and single digits -------------------------
  exact('NICE_EXACT', 'Exact Nice', '😏', 69, 'NICE'),
  exact('VERY_VERY_NICE', 'Very Very Nice', '🥵', 696969, 'NICE'),
  exact('JACKPOT_EXACT', 'Exact Jackpot', '💰', 777, 'JACKPOT'),
  exact('BOTANIST_EXACT', 'Exact Botanist', '🌿', 420, 'BOTANIST'),
  exact('HOTBOX', 'Hotbox', '💨', 420420, 'BOTANIST'),
  exact('DEVIL_EXACT', 'Exact Devil', '😈', 666, 'DEVIL'),
  exact('LEET_EXACT', 'Exact Leet', '💻', 1337, 'LEET'),
  exact('MEANING_EXACT', 'Exact Meaning', '🌌', 42, 'BOTANIST'),
  exact('UNIVERSAL_ANSWER', 'Universal Answer', '🔭', 424242, 'MEANING'),
  exact('EMERGENCY_EXACT', 'Exact Emergency', '🚑', 911, 'EMERGENCY'),
  exact('MAYDAY', 'Mayday', '🆘', 911911, 'EMERGENCY'),
  exact('EXACT_HELL', 'Exact Hell', '👹', 7734, 'HELL'),
  exact('EXACT_BOOB_80085', 'Exact 80085', '💎', 80085, 'BOOB'),
  exact('BIG_BROTHER_EXACT', 'Orwellian', '👁️', 1984, 'BIG_BROTHER'),
  exact('TREE_FIDDY_EXACT', 'Exact Tree Fiddy', '🦕', 350, 'TREE_FIDDY'),
  exact('SIXTY_SEVEN_EXACT', 'Exact Six-Seven', '🫠', 67, 'SIXTY_SEVEN'),
  exact('EIGHTY_SIX_EXACT', 'Exact Eighty-Six', '🍽️', 86, 'EIGHTY_SIX'),
  ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((v, i) =>
    exact(['DIGIT_ZERO', 'DIGIT_ONE', 'DIGIT_TWO', 'DIGIT_THREE', 'DIGIT_FOUR',
      'DIGIT_FIVE', 'DIGIT_SIX', 'DIGIT_SEVEN', 'DIGIT_EIGHT', 'DIGIT_NINE'][i], ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'][i],
      ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'][i], v, 'SINGLE_DIGIT')),

  // --- Meme substrings ----------------------------------------------------
  { id: 'NICE', label: 'Nice', emoji: '😏', fam: 'NICE', desc: 'Contains 69.', test: c => c.s.includes('69') },
  { id: 'VERY_NICE', label: 'Very Nice', emoji: '😉', fam: 'NICE', desc: 'Contains 6969.', test: c => c.s.includes('6969') },
  { id: 'BOTANIST', label: 'Botanist', emoji: '🌱', fam: 'BOTANIST', desc: 'Contains 420.', test: c => c.s.includes('420') },
  { id: 'DEVIL', label: 'Devil', emoji: '👿', fam: 'DEVIL', desc: 'Contains 666.', test: c => c.s.includes('666') },
  { id: 'LEET', label: 'Leet', emoji: '⌨️', fam: 'LEET', desc: 'Contains 1337.', test: c => c.s.includes('1337') },
  { id: 'MEANING', label: 'Meaning', emoji: '🌠', fam: 'BOTANIST', desc: 'Contains 42.', test: c => c.s.includes('42') },
  { id: 'DEEPER_MEANING', label: 'Deeper Meaning', emoji: '🛸', fam: 'MEANING', desc: 'Contains 4242.', test: c => c.s.includes('4242') },
  { id: 'EMERGENCY', label: 'Emergency', emoji: '🚨', fam: 'EMERGENCY', desc: 'Contains 911.', test: c => c.s.includes('911') },
  { id: 'HELL', label: 'Hell', emoji: '🔥', fam: 'HELL', desc: 'Contains 7734 — "hELL" on a flipped calculator.', test: c => c.s.includes('7734') },
  { id: 'BOOB_58008', label: 'Boobies', emoji: '🍈', fam: 'BOOB', desc: 'Contains 58008.', test: c => c.s.includes('58008') },
  { id: 'BIG_BROTHER', label: 'Big Brother', emoji: '📺', fam: 'BIG_BROTHER', desc: 'Contains 1984.', test: c => c.s.includes('1984') },
  { id: 'TREE_FIDDY', label: 'Tree Fiddy', emoji: '🦖', fam: 'TREE_FIDDY', desc: 'Contains 350.', test: c => c.s.includes('350') },
  { id: 'SIXTY_SEVEN', label: 'Six-Seven', emoji: '😵‍💫', fam: 'SIXTY_SEVEN', desc: 'Contains 67.', test: c => c.s.includes('67') },
  { id: 'SIXTY_SEVEN_DOUBLE', label: 'Double Six-Seven', emoji: '🤯', fam: 'SIXTY_SEVEN', desc: 'Contains 6767.', test: c => c.s.includes('6767') },
  { id: 'BRAINROT', label: 'Brainrot', emoji: '🧠', fam: 'SIXTY_SEVEN', desc: 'Contains 676767.', test: c => c.s.includes('676767') },
  { id: 'EIGHTY_SIX', label: 'Eighty-Six', emoji: '🍴', fam: 'EIGHTY_SIX', desc: 'Contains 86.', test: c => c.s.includes('86') },
  { id: 'ERROR', label: 'Not Found', emoji: '❓', fam: 'ERROR', desc: 'Contains 404.', test: c => c.s.includes('404') },

  // --- Jackpot / sevens ---------------------------------------------------
  { id: 'JACKPOT', label: 'Jackpot', emoji: '🎰', fam: 'JACKPOT', desc: 'Contains 777.', test: c => c.s.includes('777') },
  { id: 'JACKPOT_FOUR', label: 'Jackpot Four', emoji: '🎲', fam: 'JACKPOT', desc: 'Contains 7777.', test: c => c.s.includes('7777') },
  { id: 'JACKPOT_FIVE', label: 'Jackpot Five', emoji: '🏆', fam: 'JACKPOT', desc: 'Contains 77777.', test: c => c.s.includes('77777') },
  { id: 'JACKPOT_SIX', label: 'Jackpot Six', emoji: '🏦', fam: 'JACKPOT', desc: 'Contains 777777.', test: c => c.s.includes('777777') },
  { id: 'LUCKY_7', label: 'Lucky Seven', emoji: '🍀', fam: null, desc: 'Contains at least one 7.', test: c => c.counts[7] > 0 },

  // --- Constants: digits of pi, e, tau ------------------------------------

  // --- Poker-shaped digit patterns ---------------------------------------
  { id: 'PAIR', label: 'Pair', emoji: '👯', fam: 'PAIRS', desc: 'Some digit appears at least twice.', test: c => c.maxCount >= 2 },
  { id: 'TWO_PAIR', label: 'Two Pair', emoji: '👨‍👩‍👦', fam: 'PAIRS', desc: 'Two digits each appear exactly twice.', test: c => exactly(c, 2) >= 2 },
  { id: 'THREE_PAIR', label: 'Three Pair', emoji: '👨‍👩‍👧‍👦', fam: 'PAIRS', desc: 'Three digits each appear exactly twice.', test: c => exactly(c, 2) >= 3 },
  { id: 'CONTIGUOUS_PAIR', label: 'Adjacent Pair', emoji: '🤝', fam: 'PAIRS', desc: 'Two identical digits sit side by side.', test: c => longestRun(c) >= 2 },
  { id: 'CONTIGUOUS_TWO_PAIR', label: 'Adjacent Two Pair', emoji: '🧑‍🤝‍🧑', fam: 'PAIRS', desc: 'Contains two adjacent contiguous pairs.', test: c => adjacentPairBlocks(c) },
  { id: 'CONTIGUOUS_THREE_PAIR', label: 'Adjacent Three Pair', emoji: '🫂', fam: 'PAIRS', desc: 'Contains three adjacent contiguous pairs.', test: c => exactly(c, 2) === 3 && runsOfLength(c, 2) === 3 },
  { id: 'TRIPS', label: 'Three of a Kind', emoji: '🎯', fam: 'OF_A_KIND', desc: 'Some digit appears exactly three times.', test: c => exactly(c, 3) > 0 },
  { id: 'QUADS', label: 'Four of a Kind', emoji: '🍀', fam: 'OF_A_KIND', desc: 'Contains four identical digits.', test: c => c.maxCount >= 4 },
  { id: 'CONTIGUOUS_TRIPS', label: 'Triple Run', emoji: '🧱', fam: 'CONTIGUOUS_RUN', desc: 'Three identical digits in a row.', test: c => longestRun(c) >= 3 },
  { id: 'CONTIGUOUS_QUADS', label: 'Quad Run', emoji: '🏗️', fam: 'CONTIGUOUS_RUN', desc: 'Four identical digits in a row.', test: c => longestRun(c) >= 4 },
  { id: 'CONTIGUOUS_FIVES', label: 'Quint Run', emoji: '🗼', fam: 'CONTIGUOUS_RUN', desc: 'Five identical digits in a row.', test: c => longestRun(c) >= 5 },
  { id: 'CONTIGUOUS_SIXES', label: 'Monolith', emoji: '🗿', fam: 'CONTIGUOUS_RUN', desc: 'Six identical digits in a row.', test: c => longestRun(c) >= 6 },
  { id: 'BOAT', label: 'Full House', emoji: '🏠', fam: 'BOAT', desc: 'Contains a set of three and a set of two.', test: c => atLeast(c, 3) > 0 && atLeast(c, 2) >= 2 },
  { id: 'CONTIGUOUS_BOAT', label: 'Packed House', emoji: '🏘️', fam: 'BOAT', desc: 'Contains a contiguous set of three adjacent to a contiguous set of two.', test: c => adjacentRuns(c, 3, 2) },
  { id: 'SNAKE_EYES', label: 'Snake Eyes', emoji: '🎲', fam: null, desc: 'Contains a single pair of ones and no other pairs.', test: c => {
      if (c.counts[1] !== 2) return false;
      for (let v = 0; v < 10; v++) if (v !== 1 && c.counts[v] >= 2) return false;
      return true;
    } },
  { id: 'DUALITY', label: 'Duality', emoji: '☯️', fam: 'DUALITY', desc: 'Uses exactly two different digits.', test: c => c.distinct === 2 },
  { id: 'FIREFLY', label: 'Firefly', emoji: '🪰', fam: 'DUALITY', desc: 'One unique digit among identical others.', test: c => c.len >= 4 && c.distinct === 2 && exactly(c, 1) === 1 },

  // --- Straights and ladders ---------------------------------------------
  { id: 'SEQUENCE_3', label: 'Sequence', emoji: '🪜', fam: 'PROGRESSION', desc: 'Three consecutive digits in a row, up or down.', test: c => longestLadder(c) >= 3 },
  { id: 'SEQUENCE_4', label: 'Long Sequence', emoji: '🧗', fam: 'PROGRESSION', desc: 'Four consecutive digits in a row.', test: c => longestLadder(c) >= 4 },
  { id: 'STRAIGHT', label: 'Straight', emoji: '➡️', fam: 'STRAIGHT', desc: 'Five consecutive digits in a row.', test: c => longestLadder(c) >= 5 },
  { id: 'SEQUENCE_6', label: 'Perfect Straight', emoji: '🚀', fam: 'PROGRESSION', desc: 'All six digits consecutive.', test: c => c.len === 6 && longestLadder(c) === 6 },
  { id: 'SCRAMBLE', label: 'Scramble', emoji: '🔀', fam: 'PROGRESSION', desc: 'All digits form a consecutive sequence when sorted.', test: c => isScramble(c) },
  { id: 'ASCENSION', label: 'Ascension', emoji: '📈', fam: 'MONOTONIC', desc: 'Every digit is strictly larger than the previous.', test: c => strictlyMonotonic(c, true) },
  { id: 'DECAY', label: 'Decay', emoji: '📉', fam: 'MONOTONIC', desc: 'Every digit is strictly smaller than the previous.', test: c => strictlyMonotonic(c, false) },

  // --- Terrain ------------------------------------------------------------
  { id: 'MOUNTAIN', label: 'Mountain', emoji: '⛰️', fam: 'PEAK', desc: 'Rises to one peak, then falls.', test: c => isPeak(c, true) },
  { id: 'VALLEY', label: 'Valley', emoji: '🏞️', fam: 'PEAK', desc: 'Falls to one low point, then rises.', test: c => isPeak(c, false) },
  { id: 'HOPSCOTCH', label: 'Hopscotch', emoji: '🦘', fam: 'HOPSCOTCH', desc: 'A digit appears at every other position (2 times).', test: c => isHopscotch(c) },

  // --- Symmetry -----------------------------------------------------------
  { id: 'PALINDROME', label: 'Palindrome', emoji: '🪞', fam: 'PALINDROME', desc: 'Reads the same backwards.', test: c => isPalindrome(c.s) },
  { id: 'BOOKENDS', label: 'Bookends', emoji: '📚', fam: 'BOOKENDS', desc: 'The first two digits match the last two.', test: c => c.len >= 4 && c.s.slice(0, 2) === c.s.slice(-2) },
  { id: 'PAIRED_BOOKENDS', label: 'Paired Bookends', emoji: '🗄️', fam: 'BOOKENDS', desc: 'Starts with a pair and ends with a different pair.', test: c => c.len >= 4 && c.d[0] === c.d[1] && c.d[c.len - 2] === c.d[c.len - 1] && c.d[0] !== c.d[c.len - 1] },
  { id: 'ORIENTATION', label: 'Orientation', emoji: '🔄', fam: 'ORIENTATION', desc: 'Contains "101" (intro course number).', test: c => c.s.includes('101') },
  { id: 'ORIENTATION_EXACT', label: 'Exact Orientation', emoji: '🙃', fam: 'ORIENTATION', desc: 'Exactly "101".', test: c => c.n === 101 },
  { id: 'RHYME', label: 'Rhyme', emoji: '🎵', fam: 'REPEAT', desc: 'Contains the same 2+ digit substring twice.', test: c => repeatsSubstring(c, 2) },
  { id: 'MINI_ECHO', label: 'Echo', emoji: '📣', fam: 'REPEAT', desc: 'Contains an adjacent 2-digit repeat.', test: c => hasAdjacentEcho(c) },
  { id: 'EQUILIBRIUM', label: 'Equilibrium', emoji: '🧘', fam: 'EQUILIBRIUM', desc: 'The first and last digits are identical.', test: c => c.len >= 2 && c.d[0] === c.d[c.len - 1] },
  { id: 'SANDWICH', label: 'Sandwich', emoji: '🥪', fam: 'EQUILIBRIUM', desc: 'First and last digits match, with at least one different digit between them.', test: c => c.len >= 3 && c.d[0] === c.d[c.len - 1] && c.d.slice(1, -1).some(v => v !== c.d[0]) },

  // --- Zeros --------------------------------------------------------------
  { id: 'DEEP_VOID', label: 'Void', emoji: '🕳️', fam: 'VOID_DEPTH', desc: 'Two zeros in a row.', test: c => c.s.includes('00') },
  { id: 'DEEP_VOID_THREE', label: 'Deep Void', emoji: '🌑', fam: 'VOID_DEPTH', desc: 'Three zeros in a row.', test: c => c.s.includes('000') },
  { id: 'DEEP_VOID_FOUR', label: 'Deeper Void', emoji: '🌚', fam: 'VOID_DEPTH', desc: 'Four zeros in a row.', test: c => c.s.includes('0000') },
  { id: 'DEEP_VOID_FIVE', label: 'Abyss', emoji: '🌀', fam: 'VOID_DEPTH', desc: 'Five zeros in a row.', test: c => c.s.includes('00000') },

  // --- Nine endings -------------------------------------------------------
  { id: 'DOUBLE_NINE', label: 'Double Nine', emoji: '🛒', fam: 'NINE_ENDING', desc: 'Ends in 99.', test: c => c.n % 100 === 99 },
  { id: 'TRIPLE_NINE', label: 'Triple Nine', emoji: '🏷️', fam: 'NINE_ENDING', desc: 'Ends in 999.', test: c => c.n % 1000 === 999 },
  { id: 'QUAD_NINE', label: 'Quad Nine', emoji: '💸', fam: 'NINE_ENDING', desc: 'Ends in 9999.', test: c => c.n % 10000 === 9999 },
  { id: 'QUINT_NINE', label: 'Quint Nine', emoji: '🤑', fam: 'NINE_ENDING', desc: 'Ends in 99999.', test: c => c.n % 100000 === 99999 },

  // --- Number theory ------------------------------------------------------
  { id: 'PRIME', label: 'Prime', emoji: '💎', fam: null, desc: 'Divisible only by itself and one.', test: c => isPrime(c.n) },
  { id: 'SQUARE', label: 'Perfect Square', emoji: '⬜', fam: 'POWER', desc: 'A whole number squared.', test: c => POWERS[2].has(c.n) },
  { id: 'CUBE', label: 'Perfect Cube', emoji: '🧊', fam: 'POWER', desc: 'A whole number cubed.', test: c => POWERS[3].has(c.n) },
  { id: 'FOURTH_POWER', label: 'Fourth Power', emoji: '🎁', fam: 'POWER', desc: 'A whole number to the fourth.', test: c => POWERS[4].has(c.n) },
  { id: 'FIFTH_POWER', label: 'Fifth Power', emoji: '⭐', fam: 'POWER', desc: 'A whole number to the fifth.', test: c => POWERS[5].has(c.n) },
  { id: 'SIXTH_POWER', label: 'Sixth Power', emoji: '❄️', fam: 'POWER', desc: 'A whole number to the sixth.', test: c => POWERS[6].has(c.n) },
  { id: 'SEVENTH_POWER', label: 'Seventh Power', emoji: '🌟', fam: 'POWER', desc: 'A whole number to the seventh.', test: c => POWERS[7].has(c.n) },
  { id: 'EIGHTH_POWER', label: 'Eighth Power', emoji: '🕸️', fam: 'POWER', desc: 'A whole number to the eighth.', test: c => POWERS[8].has(c.n) },
  { id: 'NINTH_POWER', label: 'Ninth Power', emoji: '🌌', fam: 'POWER', desc: 'A whole number to the ninth.', test: c => POWERS[9].has(c.n) },
  { id: 'TENTH_POWER', label: 'Tenth Power', emoji: '🛸', fam: 'POWER', desc: 'A whole number to the tenth.', test: c => POWERS[10].has(c.n) },
  { id: 'POWER_OF_TWO', label: 'Power of Two', emoji: '💾', fam: null, desc: 'A power of two.', test: c => POW2.has(c.n) },
  { id: 'POWER_OF_THREE', label: 'Power of Three', emoji: '🔱', fam: null, desc: 'A power of three.', test: c => POW3.has(c.n) },
  { id: 'FIBONACCI', label: 'Fibonacci', emoji: '🐚', fam: null, desc: 'A Fibonacci number.', test: c => FIB.has(c.n) },
  { id: 'FACTORIAL', label: 'Factorial', emoji: '❗', fam: null, desc: 'A factorial.', test: c => FACTORIAL.has(c.n) },
  { id: 'SPY', label: 'Spy', emoji: '🕵️', fam: null, desc: 'The sum of its digits equals the product of its digits.', test: c => c.sum === c.prod && c.n !== 1 && c.n !== 2 },
  { id: 'HARSHAD', label: 'Harshad', emoji: '🧮', fam: null, desc: 'Divisible by its own digit sum.', test: c => c.n > 0 && c.n % c.sum === 0 },

  // --- Digit composition --------------------------------------------------
  { id: 'HEAVY', label: 'Heavy', emoji: '🏋️', fam: null, desc: 'The sum of its digits exceeds 45.', test: c => c.sum > 45 },
  { id: 'CALENDAR', label: 'Calendar', emoji: '📅', fam: 'CALENDAR', desc: 'Contains "365" (days in a year).', test: c => c.s.includes('365') },
  // A six-digit roll can never start with a leading zero, so 02/02 can only
  // show up mid-number rather than as the leading DDMM.
  { id: 'GROUNDHOG_DAY', label: 'Groundhog Day', emoji: '🦫', fam: 'CALENDAR', desc: 'Exactly "365365".', test: c => c.n === 365365 },


  // --- Badges carried over from rngdle.com's published catalogue -----------
  // Every predicate below was verified by brute force: its measured frequency
  // over all 1,000,001 rolls reproduces the live game's EP exactly.

  exact('CALENDAR_EXACT', 'Exact Calendar', '📆', 365, 'CALENDAR'),
  { id: 'EXACT_BOOB', label: 'Exact Boob', emoji: '🍍', fam: 'BOOB', desc: 'Exactly "8008" or "58008".', test: c => c.n === 8008 || c.n === 58008 },
  { id: 'BOOB_80085', label: '80085', emoji: '💎', fam: 'BOOB', desc: 'Contains "80085" (spells BOOBS).', test: c => c.s.includes('80085') },
  { id: 'BOOB_8008', label: '8008', emoji: '🍒', fam: 'BOOB', desc: 'Contains "8008" (spells BOOB upside-down).', test: c => c.s.includes('8008') },
  { id: 'HELLO', label: 'Hello', emoji: '👋', fam: null, desc: 'Contains "07734" (spells HELLO upside-down).', test: c => c.s.includes('07734') },
  { id: 'SECRET_AGENT', label: 'Secret Agent', emoji: '🕶️', fam: null, desc: 'Contains "007".', test: c => c.s.includes('007') },

  { id: 'ELEVENTH_POWER', label: '11th Power', emoji: '🔮', fam: 'POWER', desc: 'A perfect eleventh power (n¹¹).', test: c => POWERS[11].has(c.n) },
  { id: 'THIRTEENTH_POWER', label: '13th Power', emoji: '🧿', fam: 'POWER', desc: 'A perfect thirteenth power (n¹³).', test: c => POWERS[13].has(c.n) },
  { id: 'SEVENTEENTH_POWER', label: '17th Power', emoji: '🌠', fam: 'POWER', desc: 'A perfect seventeenth power (n¹⁷).', test: c => POWERS[17].has(c.n) },
  { id: 'NINETEENTH_POWER', label: '19th Power', emoji: '☄️', fam: 'POWER', desc: 'A perfect nineteenth power (n¹⁹).', test: c => POWERS[19].has(c.n) },
  { id: 'PRONIC', label: 'Pronic Number', emoji: '📐', fam: null, desc: 'The product of two consecutive integers (n * n+1).', test: c => PRONIC.has(c.n) },

  { id: 'PI', label: 'Pi', emoji: '🥧', fam: 'PI', desc: 'Exactly π (314, 3141, 31415, or 314159).', test: c => c.n === 314 || c.n === 3141 || c.n === 31415 || c.n === 314159 },
  { id: 'PI_CONTAINS_5', label: 'Pi Slice (5)', emoji: '🥞', fam: 'PI', desc: 'Contains "31415".', test: c => c.s.includes('31415') },
  { id: 'PI_CONTAINS_4', label: 'Pi Slice (4)', emoji: '🍕', fam: 'PI', desc: 'Contains "3141".', test: c => c.s.includes('3141') },
  { id: 'PI_CONTAINS_3', label: 'Pi Slice (3)', emoji: '🔺', fam: 'PI', desc: 'Contains "314".', test: c => c.s.includes('314') },
  { id: 'E', label: "Euler's Number", emoji: '🧮', fam: 'E', desc: 'The number e (271, 2718, 27182, or 271828).', test: c => c.n === 271 || c.n === 2718 || c.n === 27182 || c.n === 271828 },
  { id: 'E_CONTAINS_5', label: 'E Slice (5)', emoji: '🧊', fam: 'E', desc: 'Contains "27182".', test: c => c.s.includes('27182') },
  { id: 'E_CONTAINS_4', label: 'E Slice (4)', emoji: '📊', fam: 'E', desc: 'Contains "2718".', test: c => c.s.includes('2718') },
  { id: 'E_CONTAINS_3', label: 'E Slice (3)', emoji: '📈', fam: 'E', desc: 'Contains "271".', test: c => c.s.includes('271') },

  { id: 'ROYAL_FLUSH', label: 'Royal Flush', emoji: '👑', fam: 'STRAIGHT', desc: 'Contains 56789 — the highest possible straight.', test: c => c.s.includes('56789') },
  { id: 'STRAIGHT_FLUSH', label: 'Straight Flush', emoji: '🎴', fam: 'STRAIGHT', desc: 'Contains 5 consecutive same-parity digits (02468, 13579, or their reverse).', test: c => c.s.includes('02468') || c.s.includes('13579') || c.s.includes('86420') || c.s.includes('97531') },
  { id: 'FLUSH', label: 'Flush', emoji: '♠️', fam: null, desc: 'All digits are either all even or all odd.', test: c => c.d.every(v => v % 2 === 0) || c.d.every(v => v % 2 === 1) },
  { id: 'ALTERNATOR', label: 'Alternator', emoji: '🔃', fam: null, desc: 'Digits strictly alternate between even and odd.', test: c => { if (c.len < 2) return false; const odd = c.d[0] % 2 === 1; for (let i = 0; i < c.len; i++) if ((c.d[i] % 2 === 1) !== ((i % 2 === 0) === odd)) return false; return true; } },

  { id: 'CASCADE', label: 'Cascade', emoji: '🌊', fam: 'PROGRESSION', desc: 'Every digit increases by exactly 1 from the previous.', test: c => { if (c.len < 2) return false; for (let i = 1; i < c.len; i++) if (c.d[i] !== c.d[i-1] + 1) return false; return true; } },
  { id: 'WATERFALL', label: 'Waterfall', emoji: '🏞️', fam: 'PROGRESSION', desc: 'Every digit decreases by exactly 1 from the previous.', test: c => { if (c.len < 2) return false; for (let i = 1; i < c.len; i++) if (c.d[i] !== c.d[i-1] - 1) return false; return true; } },
  { id: 'EVEN_SPACING', label: 'Even Spacing', emoji: '📏', fam: 'PROGRESSION', desc: 'All digits are evenly spaced in an arithmetic sequence.', test: c => { if (c.len < 3) return false; const k = c.d[1] - c.d[0]; for (let i = 2; i < c.len; i++) if (c.d[i] - c.d[i-1] !== k) return false; return true; } },
  { id: 'EVEN_SPACING_ABS', label: 'Even Spacing (Absolute)', emoji: '📐', fam: 'PROGRESSION', desc: 'All digits have the same absolute spacing (e.g., ±2 each time).', test: c => { if (c.len < 3) return false; const k = Math.abs(c.d[1] - c.d[0]); for (let i = 2; i < c.len; i++) if (Math.abs(c.d[i] - c.d[i-1]) !== k) return false; return true; } },
  { id: 'TURTLE', label: 'Turtle', emoji: '🐢', fam: 'PROGRESSION', desc: 'All consecutive digits differ by at most 1.', test: c => { if (c.len < 2) return false; for (let i = 1; i < c.len; i++) if (Math.abs(c.d[i] - c.d[i-1]) > 1) return false; return true; } },
  { id: 'HILLS', label: 'Hills', emoji: '⛰️', fam: 'HILLS', desc: 'Digits strictly alternate between rising and falling.', test: c => { if (c.len < 4) return false; for (let i = 1; i < c.len; i++) if (c.d[i] === c.d[i-1]) return false; for (let i = 2; i < c.len; i++) { const a = c.d[i-1] - c.d[i-2], b = c.d[i] - c.d[i-1]; if ((a > 0 && b > 0) || (a < 0 && b < 0)) return false; } return true; } },
  { id: 'ZIPPER', label: 'Zipper', emoji: '🧷', fam: null, desc: 'Two digits alternating perfectly.', test: c => { if (c.len < 2 || c.distinct !== 2) return false; for (let i = 1; i < c.len; i++) if (c.d[i] === c.d[i-1]) return false; return true; } },
  { id: 'HOMOGENEOUS', label: 'Homogeneous', emoji: '🧿', fam: null, desc: 'All digits are the same.', test: c => c.len >= 2 && c.distinct === 1 },
  { id: 'HETEROGENEOUS', label: 'Heterogeneous', emoji: '🌈', fam: null, desc: 'No repeated digits.', test: c => c.distinct === c.len },
  { id: 'TRINITY', label: 'Trinity', emoji: '🔱', fam: null, desc: 'Uses exactly three different digits.', test: c => c.distinct === 3 },
  { id: 'QUARTET', label: 'Quartet', emoji: '🎻', fam: null, desc: 'Uses exactly four different digits.', test: c => c.distinct === 4 },
  { id: 'BINARY_SOUL', label: 'Binary Soul', emoji: '🤖', fam: null, desc: 'Only 0s and 1s.', test: c => c.d.every(v => v <= 1) },
  { id: 'LOW_BALL', label: 'Low Ball', emoji: '🐜', fam: null, desc: 'Contains only digits from 0 to 4.', test: c => c.d.every(v => v <= 4) },
  { id: 'HIGH_ROLLER', label: 'High Roller', emoji: '🎰', fam: null, desc: 'Contains only digits from 5 to 9.', test: c => c.d.every(v => v >= 5) },
  { id: 'DIVISIBLE_BY_THREE', label: 'Divisible by Three', emoji: '3️⃣', fam: null, desc: 'Every digit is divisible by 3.', test: c => c.d.every(v => v % 3 === 0) },
  { id: 'STROBOGRAMMATIC', label: 'Strobogrammatic', emoji: '🙃', fam: null, desc: 'Looks the same when rotated 180 degrees.', test: c => { let out = ''; for (let i = c.len - 1; i >= 0; i--) { const f = FLIP[c.d[i]]; if (f === undefined) return false; out += f; } return out === c.s; } },

  { id: 'FRAMED_PAIR', label: 'Framed Pair', emoji: '🖼️', fam: 'PAIRS', desc: 'A 4-digit number where the middle two digits match each other but differ from both end digits.', test: c => c.len === 4 && c.d[1] === c.d[2] && c.d[0] !== c.d[1] && c.d[3] !== c.d[1] },
  { id: 'FRAMED_TRIPLE', label: 'Framed Triple', emoji: '🏵️', fam: 'OF_A_KIND', desc: 'A triple in the middle, bookended by different digits.', test: c => c.len === 5 && c.d[1] === c.d[2] && c.d[2] === c.d[3] && c.d[0] !== c.d[1] && c.d[4] !== c.d[1] },
  { id: 'FRAMED_DOUBLE', label: 'Framed Double', emoji: '🗂️', fam: 'PAIRS', desc: 'Two pairs in the middle, bookended by different digits.', test: c => c.len === 6 && c.d[1] === c.d[2] && c.d[3] === c.d[4] && c.d[1] !== c.d[3] && c.d[0] !== c.d[1] && c.d[5] !== c.d[4] },
  { id: 'MIRROR_BOOKENDS', label: 'Mirror Bookends', emoji: '🪞', fam: 'BOOKENDS', desc: 'First two digits are reversed as the last two.', test: c => c.len >= 4 && c.d[0] === c.d[c.len - 1] && c.d[1] === c.d[c.len - 2] },
  { id: 'DOUBLE_HOP', label: 'Double Hop', emoji: '🦟', fam: 'HOPSCOTCH', desc: 'A digit appears at every other position (3 times).', test: c => { if (c.len < 5 || c.distinct < 2) return false; for (let i = 0; i + 4 < c.len; i++) { if (c.d[i] === c.d[i+2] && c.d[i+2] === c.d[i+4]) { const on = i + 6 < c.len && c.d[i+6] === c.d[i], back = i >= 2 && c.d[i-2] === c.d[i]; if (!on && !back) return true; } } return false; } },

  { id: 'CLEAN', label: 'Clean', emoji: '🧼', fam: null, desc: 'Ends in a zero.', test: c => c.n % 10 === 0 },
  { id: 'SEMI_CLEAN', label: 'Semi-Clean', emoji: '🫧', fam: null, desc: 'Ends in a 5.', test: c => c.n % 10 === 5 },
  { id: 'CENTURY', label: 'Century', emoji: '💯', fam: null, desc: 'Ends in double zeros.', test: c => c.s.endsWith('00') },
  { id: 'SEMI_CENTURY', label: 'Semi-Century', emoji: '🌟', fam: null, desc: 'Ends in "50".', test: c => c.n % 100 === 50 },
  { id: 'MILLENNIUM', label: 'Millennium', emoji: '✨', fam: null, desc: 'Ends in triple zeros.', test: c => c.s.endsWith('000') },
  { id: 'SEMI_MILLENNIUM', label: 'Semi-Millennium', emoji: '🌠', fam: null, desc: 'Ends in "500".', test: c => c.n % 1000 === 500 },
  { id: 'SEMI_EPOCH', label: 'Semi-Epoch', emoji: '⏳', fam: null, desc: 'Ends in "5000".', test: c => c.n % 10000 === 5000 },
  { id: 'COLOSSAL', label: 'Colossal', emoji: '🗿', fam: null, desc: 'A number greater than 999,000.', test: c => c.n > 999000 },

  { id: 'ELEVEN', label: 'Eleven', emoji: '🎱', fam: null, desc: 'Divisible by 11.', test: c => c.n % 11 === 0 },
  { id: 'DOZEN', label: 'Dozen', emoji: '🥚', fam: null, desc: 'Divisible by 12.', test: c => c.n % 12 === 0 },
  { id: 'LUCKY_SEVEN_DIV', label: 'Lucky Seven (Divisible)', emoji: '🍀', fam: null, desc: 'Divisible by 7.', test: c => c.n % 7 === 0 },
  { id: 'BLACKJACK', label: 'Blackjack', emoji: '♠️', fam: null, desc: 'Digits sum exactly to 21.', test: c => c.sum === 21 },
  { id: 'FEATHER', label: 'Feather', emoji: '🪶', fam: null, desc: 'The sum of its digits is less than 15.', test: c => c.sum < 15 },
  { id: 'BALANCED', label: 'Balanced', emoji: '⚖️', fam: null, desc: 'Sum of first half of digits equals sum of second half.', test: c => { if (c.len < 2 || c.len % 2 !== 0) return false; const h = c.len / 2; let a = 0, b = 0; for (let i = 0; i < h; i++) { a += c.d[i]; b += c.d[i + h]; } return a === b; } },

  { id: 'GAP_ONE', label: 'Gap One', emoji: '🚪', fam: null, desc: 'The first and last digits differ by exactly 1.', test: c => c.len >= 2 && Math.abs(c.d[0] - c.d[c.len - 1]) === 1 },
  { id: 'GROUNDED', label: 'Grounded', emoji: '🛬', fam: null, desc: 'The first digit is smaller than the last.', test: c => c.len >= 2 && c.d[0] < c.d[c.len - 1] },
  { id: 'LIFTOFF', label: 'Liftoff', emoji: '🚀', fam: null, desc: 'The first digit is larger than the last.', test: c => c.len >= 2 && c.d[0] > c.d[c.len - 1] },
  { id: 'NEIGHBORS', label: 'Neighbors', emoji: '🏘️', fam: null, desc: 'Contains two digits that are adjacent in value.', test: c => { for (let i = 0; i + 1 < c.len; i++) if (Math.abs(c.d[i] - c.d[i+1]) === 1) return true; return false; } },
  { id: 'ECHO', label: 'Echo', emoji: '🔁', fam: null, desc: 'The first half repeats as the second half.', test: c => c.len % 2 === 0 && c.s.slice(0, c.len / 2) === c.s.slice(c.len / 2) },
  { id: 'VOID', label: 'Void', emoji: '⬜', fam: null, desc: 'Contains no zeros.', test: c => c.counts[0] === 0 },
  { id: 'GHOST', label: 'Ghost', emoji: '👻', fam: null, desc: 'Contains exactly one "0".', test: c => c.counts[0] === 1 },

  // The element series: exactly one of the given digit.
  { id: 'HYDROGEN', label: 'Hydrogen (1)', emoji: '💧', fam: null, desc: 'Contains exactly one "1".', test: c => c.counts[1] === 1 },
  { id: 'HELIUM', label: 'Helium (2)', emoji: '🎈', fam: null, desc: 'Contains exactly one "2".', test: c => c.counts[2] === 1 },
  { id: 'LITHIUM', label: 'Lithium (3)', emoji: '🔋', fam: null, desc: 'Contains exactly one "3".', test: c => c.counts[3] === 1 },
  { id: 'BERYLLIUM', label: 'Beryllium (4)', emoji: '💎', fam: null, desc: 'Contains exactly one "4".', test: c => c.counts[4] === 1 },
  { id: 'BORON', label: 'Boron (5)', emoji: '🧪', fam: null, desc: 'Contains exactly one "5".', test: c => c.counts[5] === 1 },
  { id: 'CARBON', label: 'Carbon (6)', emoji: '⚫', fam: null, desc: 'Contains exactly one "6".', test: c => c.counts[6] === 1 },
  { id: 'NITROGEN', label: 'Nitrogen (7)', emoji: '💨', fam: null, desc: 'Contains exactly one "7".', test: c => c.counts[7] === 1 },
  { id: 'OXYGEN', label: 'Oxygen (8)', emoji: '🌬️', fam: null, desc: 'Contains exactly one "8".', test: c => c.counts[8] === 1 },
  { id: 'FLUORINE', label: 'Fluorine (9)', emoji: '🧴', fam: null, desc: 'Contains exactly one "9".', test: c => c.counts[9] === 1 },


  // --- Restored: present in the live game's full badge bundle -------------
  exact('ERROR_EXACT', 'Exact Not Found', '🚫', 404, 'ERROR'),
  { id: 'ULTIMEME_EXACT', label: 'Funny Number', emoji: '😂', fam: 'ULTIMEME', desc: 'Exactly 69420 or 42069.', test: c => c.s === '69420' || c.s === '42069' },
  { id: 'GOLDEN_RATIO', label: 'Golden Ratio', emoji: '🐚', fam: null, desc: 'The golden ratio: 1618, 16180 or 161803.', test: c => c.s === '1618' || c.s === '16180' || c.s === '161803' },
  exact('FULL_DAY', 'Full Day', '⏱️', 86400, null, 'Rolled 86400 — the number of seconds in a day.'),
  { id: 'INFERNAL', label: 'Infernal', emoji: '🔱', fam: 'DEVIL', desc: 'Exactly 666666.', test: c => c.n === 666666 },
  { id: 'ULTIMEME', label: 'Ultimeme', emoji: '🎴', fam: 'ULTIMEME', desc: 'Contains both 69 and 420.', test: c => c.s.includes('69') && c.s.includes('420') },
  { id: 'FIVE_OF_A_KIND', label: 'Five of a Kind', emoji: '🃏', fam: 'OF_A_KIND', desc: 'Contains five identical digits.', test: c => c.maxCount >= 5 },
  { id: 'ARITHMETIC', label: 'Metronome', emoji: '🎼', fam: 'PROGRESSION', desc: 'Splits into three or more numbers in arithmetic progression.', test: c => splitMatches(c.s, nums => { const step = nums[1] - nums[0]; if (step === -1 || step === 0 || step === 1) return false; for (let i = 2; i < nums.length; i++) if (nums[i] - nums[i-1] !== step) return false; return true; }) },
  { id: 'GEOMETRIC', label: 'Crescendo', emoji: '🔊', fam: 'PROGRESSION', desc: 'Splits into three or more numbers in geometric progression.', test: c => splitMatches(c.s, nums => { if (nums.some(v => v <= 0) || nums[0] === nums[1]) return false; for (let i = 0; i + 2 < nums.length; i++) if (nums[i+1] * nums[i+1] !== nums[i] * nums[i+2]) return false; return true; }) },
  { id: 'STEPS', label: 'Steps', emoji: '🪜', fam: 'MONOTONIC', desc: 'Digits never decrease, and rise at least once.', test: c => { if (c.len < 2) return false; let rose = false; for (let i = 1; i < c.len; i++) { if (c.d[i] < c.d[i-1]) return false; if (c.d[i] > c.d[i-1]) rose = true; } return rose; } },
  { id: 'SLOPES', label: 'Slopes', emoji: '🛝', fam: 'MONOTONIC', desc: 'Digits never increase, and fall at least once.', test: c => { if (c.len < 2) return false; let fell = false; for (let i = 1; i < c.len; i++) { if (c.d[i] > c.d[i-1]) return false; if (c.d[i] < c.d[i-1]) fell = true; } return fell; } },
  { id: 'MESA', label: 'Mesa', emoji: '🏜️', fam: 'PEAK', desc: 'Digits rise to a peak, then fall (flat stretches allowed).', test: c => isTerrace(c, true) },
  { id: 'CANYON', label: 'Canyon', emoji: '🪨', fam: 'PEAK', desc: 'Digits fall to a low point, then rise (flat stretches allowed).', test: c => isTerrace(c, false) },
  { id: 'POCKET_MIRROR', label: 'Pocket Mirror', emoji: '🪞', fam: 'PALINDROME', desc: 'Contains a palindrome of four or more digits.', test: c => { for (let L = 4; L <= c.len; L++) for (let i = 0; i + L <= c.len; i++) if (isPalindrome(c.s.slice(i, i + L))) return true; return false; } },
  { id: 'POWER_OF_FIVE', label: 'Power of Five', emoji: '🖐️', fam: null, desc: 'A power of five.', test: c => POW5.has(c.n) },
  { id: 'POWER_OF_SEVEN', label: 'Power of Seven', emoji: '🎰', fam: null, desc: 'A power of seven.', test: c => POW7.has(c.n) },
  { id: 'EQUATION', label: 'Equation', emoji: '🟰', fam: null, desc: 'Splits into three numbers where the first two make the third.', test: c => !!splitParts(c.s, 3, ([a, b, r]) => { if (!a || !b || !r) return false; return a + b === r || a - b === r || a * b === r || (a % b === 0 && a / b === r); }) },


  // --- Remaining badges from the live bundle -------------------------------
  { id: 'ONE_MILLION', label: 'One Million', emoji: '🐐', fam: null, desc: 'Exactly 1,000,000.', test: c => c.n === 1000000 },
  { id: 'FOOTBALL_17776', label: '17776', emoji: '🏈', fam: null, desc: 'Exactly 17776.', test: c => c.n === 17776 },
  { id: 'ALWAYS', label: 'Always', emoji: '♾️', fam: 'CALENDAR', desc: 'Exactly 247365 or 365247 — 24/7, 365.', test: c => c.s === '247365' || c.s === '365247' },
  { id: 'OUROBOROS', label: 'Ouroboros', emoji: '🐍', fam: 'POWER', desc: 'A number raised to itself (n^n).', test: c => OUROBOROS.has(c.n) },
  { id: 'TAU', label: 'Tau', emoji: '🌀', fam: 'TAU', desc: 'Exactly τ (6283, 62831 or 628318).', test: c => c.s === '6283' || c.s === '62831' || c.s === '628318' },
  { id: 'TAU_SLICE_5', label: 'Tau Slice (5)', emoji: '🎢', fam: 'TAU', desc: 'Contains "62831".', test: c => c.s.includes('62831') },
  { id: 'TAU_SLICE_4', label: 'Tau Slice (4)', emoji: '🎡', fam: 'TAU', desc: 'Contains "6283".', test: c => c.s.includes('6283') },
  { id: 'FRAMED_QUAD', label: 'Framed Quad', emoji: '🪟', fam: 'OF_A_KIND', desc: 'A quad in the middle, bookended by different digits.', test: c => c.len === 6 && c.d[1] === c.d[2] && c.d[2] === c.d[3] && c.d[3] === c.d[4] && c.d[0] !== c.d[1] && c.d[5] !== c.d[4] },
  { id: 'MINI_SCRAMBLE', label: 'Mini Scramble', emoji: '🧩', fam: 'PROGRESSION', desc: 'Contains three or more digits that sort into a consecutive run.', test: c => { for (let L = 3; L <= c.len; L++) for (let i = 0; i + L <= c.len; i++) { const a = [...c.s.slice(i, i + L)].map(Number).sort((x, y) => x - y); let ok = true; for (let k = 1; k < a.length; k++) if (a[k] !== a[k-1] + 1) { ok = false; break; } if (ok) return true; } return false; } },
  { id: 'DUNES', label: 'Dunes', emoji: '🐫', fam: 'HILLS', desc: 'Ignoring repeats, digits alternate between rising and falling.', test: c => { let coll = c.s[0] ?? ''; for (let i = 1; i < c.len; i++) if (c.s[i] !== c.s[i-1]) coll += c.s[i]; if (coll.length < 4) return false; for (let i = 2; i < coll.length; i++) { const a = +coll[i-1] - +coll[i-2], b = +coll[i] - +coll[i-1]; if ((a > 0 && b > 0) || (a < 0 && b < 0)) return false; } return true; } },


  // --- Consecutive numbers written end to end ------------------------------
  { id: 'CONSEC_PAIR_EXACT', label: '2 Consecutive Numbers', emoji: '🔗', fam: 'CONSECUTIVE', desc: 'The entire number splits into two consecutive integers.', test: c => { for (let t = 1; t < c.len; t++) { const a = c.s.slice(0, t), b = c.s.slice(t); if (leadingZero(a) || leadingZero(b) || !multiPart([a, b])) continue; if (Math.abs(Number(a) - Number(b)) === 1) return true; } return false; } },
  { id: 'CONSEC_PAIR_ADJACENT', label: '2 Consecutive Numbers (Contains)', emoji: '🔗', fam: 'CONSECUTIVE', desc: 'Contains two adjacent substrings that are consecutive integers.', test: c => containsRun(c.s, 2) },
  { id: 'CONSEC_PAIR_NEARBY', label: '2 Consecutive Numbers (Nearby)', emoji: '🔗', fam: 'CONSECUTIVE', desc: 'Contains two non-adjacent substrings that are consecutive integers.', test: c => nearbyConsecutivePair(c.s) },
  { id: 'CONSEC_TRIPLE_EXACT', label: '3 Consecutive Numbers', emoji: '⛓️', fam: 'CONSECUTIVE', desc: 'The entire number splits into three consecutive integers in order.', test: c => { const n = wholeSplitConsecutive(c.s, 3); return !!n && inSequence(n); } },
  { id: 'CONSEC_TRIPLE_SCRAMBLED', label: '3 Consecutive Numbers (Scrambled)', emoji: '⛓️', fam: 'CONSECUTIVE', desc: 'The entire number splits into three consecutive integers, but not in order.', test: c => { const n = wholeSplitConsecutive(c.s, 3); return !!n && !inSequence(n); } },
  { id: 'CONSEC_TRIPLE_CONTAINS', label: '3 Consecutive Numbers (Contains)', emoji: '🔗', fam: 'CONSECUTIVE', desc: 'Contains three adjacent consecutive integers.', test: c => containsRun(c.s, 3) },
  { id: 'CONSEC_QUAD_EXACT', label: '4 Consecutive Numbers', emoji: '⛓️', fam: 'CONSECUTIVE', desc: 'The entire number splits into four consecutive integers in order.', test: c => { const n = wholeSplitConsecutive(c.s, 4); return !!n && inSequence(n); } },
  { id: 'CONSEC_QUAD_SCRAMBLED', label: '4 Consecutive Numbers (Scrambled)', emoji: '⛓️', fam: 'CONSECUTIVE', desc: 'The entire number splits into four consecutive integers, but not in order.', test: c => { const n = wholeSplitConsecutive(c.s, 4); return !!n && !inSequence(n); } },
  { id: 'CONSEC_QUAD_CONTAINS', label: '4 Consecutive Numbers (Contains)', emoji: '🔗', fam: 'CONSECUTIVE', desc: 'Contains four adjacent consecutive integers.', test: c => containsRun(c.s, 4) },

  // --- Baseline -----------------------------------------------------------
  { id: 'EVEN', label: 'Even', emoji: '⚖️', fam: null, desc: 'An even number.', test: c => c.n % 2 === 0 },
  { id: 'ODD', label: 'Odd', emoji: '🦄', fam: null, desc: 'An odd number.', test: c => c.n % 2 === 1 },
  { id: 'ONE_DIGIT', label: 'One Digit', emoji: '🔹', fam: 'SINGLE_DIGIT', desc: 'A single-digit roll.', test: c => c.len === 1 },
  { id: 'TWO_DIGITS', label: 'Two Digits', emoji: '🔸', fam: null, desc: 'A two-digit roll.', test: c => c.len === 2 },
  { id: 'THREE_DIGITS', label: 'Three Digits', emoji: '🔶', fam: null, desc: 'A three-digit roll.', test: c => c.len === 3 },
  { id: 'FOUR_DIGITS', label: 'Four Digits', emoji: '🔷', fam: null, desc: 'A four-digit roll.', test: c => c.len === 4 },
  { id: 'FIVE_DIGITS', label: 'Five Digits', emoji: '🟣', fam: null, desc: 'A five-digit roll.', test: c => c.len === 5 },
  { id: 'SIX_DIGITS', label: 'Six Digits', emoji: '🐝', fam: null, desc: 'A six-digit roll.', test: c => c.len === 6 },
];

/** Human-readable names for the supersession families. */
export const FAMILY_NAMES = {
  BIG_BROTHER: 'Big Brother',
  BOAT: 'Boat',
  BOOB: 'Boob',
  BOOKENDS: 'Bookends',
  BOTANIST: 'Botanist',
  CALENDAR: 'Calendar',
  CONSECUTIVE: 'Consecutive',
  CONTIGUOUS_RUN: 'Contiguous Run',
  DEVIL: 'Devil',
  DUALITY: 'Duality',
  E: 'E',
  EIGHTY_SIX: 'Eighty Six',
  EMERGENCY: 'Emergency',
  EQUILIBRIUM: 'Equilibrium',
  ERROR: 'Error',
  HELL: 'Hell',
  HILLS: 'Hills',
  HOPSCOTCH: 'Hopscotch',
  JACKPOT: 'Jackpot',
  LEET: 'Leet',
  MEANING: 'Meaning',
  MONOTONIC: 'Monotonic',
  NICE: 'Nice',
  NINE_ENDING: 'Nine Ending',
  OF_A_KIND: 'Of A Kind',
  ORIENTATION: 'Orientation',
  PAIRS: 'Pairs',
  PALINDROME: 'Palindrome',
  PEAK: 'Peak',
  PI: 'Pi',
  POWER: 'Power',
  PROGRESSION: 'Progression',
  REPEAT: 'Repeat',
  SINGLE_DIGIT: 'Single Digit',
  SIXTY_SEVEN: 'Sixty Seven',
  STRAIGHT: 'Straight',
  TAU: 'Tau',
  TREE_FIDDY: 'Tree Fiddy',
  ULTIMEME: 'Ultimeme',
  VOID_DEPTH: 'Void Depth',
};

if (new Set(BADGES.map(b => b.id)).size !== BADGES.length) {
  throw new Error('duplicate badge id in BADGES');
}
