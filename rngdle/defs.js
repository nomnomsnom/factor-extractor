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
  if (c.len < 3 || c.distinct !== c.len) return false;
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

/** Rises to a plateau of equal digits then falls (or the inverse). */
const isPlateau = (c, up) => {
  if (c.len < 4) return false;
  let i = 1;
  while (i < c.len && (up ? c.d[i] > c.d[i - 1] : c.d[i] < c.d[i - 1])) i++;
  if (i === 1) return false;
  let j = i;
  while (j < c.len && c.d[j] === c.d[j - 1]) j++;
  if (j === i) return false; // no flat top
  if (j === c.len) return false; // never came back down
  for (let k = j; k < c.len; k++) {
    if (up ? c.d[k] >= c.d[k - 1] : c.d[k] <= c.d[k - 1]) return false;
  }
  return true;
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

/** Alternating two-digit pattern: ababab with a !== b. */
const isAlternating = c => {
  if (c.len < 4 || c.distinct !== 2) return false;
  for (let i = 2; i < c.len; i++) if (c.d[i] !== c.d[i - 2]) return false;
  return c.d[0] !== c.d[1];
};

/** The whole number is a block repeated `times` times, e.g. 123123. */
const isRepeatedBlock = (c, times) => {
  if (c.len % times !== 0) return false;
  const size = c.len / times;
  const block = c.s.slice(0, size);
  if (block === block[0].repeat(size)) return false; // that's a repdigit, not an echo
  for (let i = 1; i < times; i++) {
    if (c.s.slice(i * size, (i + 1) * size) !== block) return false;
  }
  return true;
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

/** Count of non-overlapping adjacent doubles, e.g. 114455 -> 3. */
const doubleRuns = c => c.runs.filter(r => r >= 2).length;

/** Digits readable upside down, and reading as the same number when flipped. */
const FLIP = { 0: '0', 1: '1', 6: '9', 8: '8', 9: '6' };
const isStrobogrammatic = c => {
  let out = '';
  for (let i = c.len - 1; i >= 0; i--) {
    const f = FLIP[c.d[i]];
    if (f === undefined) return false;
    out += f;
  }
  return out === c.s;
};

/** Reads as a valid DDMMYY date. */
const isCalendar = c => {
  if (c.len !== 6) return false;
  const day = +c.s.slice(0, 2), month = +c.s.slice(2, 4);
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
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
  exact('MEANING_EXACT', 'Exact Meaning', '🌌', 42, 'MEANING'),
  exact('UNIVERSAL_ANSWER', 'Universal Answer', '🔭', 424242, 'MEANING'),
  exact('EMERGENCY_EXACT', 'Exact Emergency', '🚑', 911, 'EMERGENCY'),
  exact('MAYDAY', 'Mayday', '🆘', 911911, 'EMERGENCY'),
  exact('HELL_EXACT', 'Exact Hell', '👹', 7734, 'HELL'),
  exact('BOOB_EXACT', 'Exact 80085', '💎', 80085, 'BOOB'),
  exact('BIG_BROTHER_EXACT', 'Orwellian', '👁️', 1984, 'BIG_BROTHER'),
  exact('TREE_FIDDY_EXACT', 'Exact Tree Fiddy', '🦕', 350, 'TREE_FIDDY'),
  exact('SIXTY_SEVEN_EXACT', 'Exact Six-Seven', '🫠', 67, 'SIXTY_SEVEN'),
  exact('EIGHTY_SIX_EXACT', 'Exact Eighty-Six', '🍽️', 86, 'EIGHTY_SIX'),
  exact('ERROR_EXACT', 'Exact Not Found', '🚫', 404, 'ERROR'),
  exact('ULTIMEME_EXACT', 'Exact Ultimeme', '🃏', 69420, 'ULTIMEME'),
  exact('PI_EXACT', 'Exact Pi', '🥧', 314159, 'PI'),
  exact('E_EXACT', 'Exact e', '🧮', 271828, 'E'),
  exact('TAU_EXACT', 'Exact Tau', '🌀', 628318, 'TAU'),
  exact('GOLDEN_RATIO', 'Golden Ratio', '🐚', 161803, null),
  exact('SPEED_OF_LIGHT', 'Lightspeed', '💫', 299792, null),
  exact('FULL_DAY', 'Full Day', '⏱️', 86400, null, 'Rolled 86400 — the number of seconds in a day.'),
  ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((v, i) =>
    exact(`DIGIT_${v}`, ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'][i],
      ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'][i], v, 'SINGLE_DIGIT')),
  exact('MILLION', 'Millionaire', '🎩', 1000000, null, 'Rolled the ceiling itself: 1,000,000.'),

  // --- Meme substrings ----------------------------------------------------
  { id: 'NICE', label: 'Nice', emoji: '😏', fam: 'NICE', desc: 'Contains 69.', test: c => c.s.includes('69') },
  { id: 'VERY_NICE', label: 'Very Nice', emoji: '😉', fam: 'NICE', desc: 'Contains 6969.', test: c => c.s.includes('6969') },
  { id: 'BOTANIST', label: 'Botanist', emoji: '🌱', fam: 'BOTANIST', desc: 'Contains 420.', test: c => c.s.includes('420') },
  { id: 'DEVIL', label: 'Devil', emoji: '👿', fam: 'DEVIL', desc: 'Contains 666.', test: c => c.s.includes('666') },
  { id: 'INFERNAL', label: 'Infernal', emoji: '🔥', fam: 'DEVIL', desc: 'Contains 6666.', test: c => c.s.includes('6666') },
  { id: 'LEET', label: 'Leet', emoji: '⌨️', fam: 'LEET', desc: 'Contains 1337.', test: c => c.s.includes('1337') },
  { id: 'MEANING', label: 'Meaning', emoji: '🌠', fam: 'MEANING', desc: 'Contains 42.', test: c => c.s.includes('42') },
  { id: 'DEEPER_MEANING', label: 'Deeper Meaning', emoji: '🛸', fam: 'MEANING', desc: 'Contains 4242.', test: c => c.s.includes('4242') },
  { id: 'EMERGENCY', label: 'Emergency', emoji: '🚨', fam: 'EMERGENCY', desc: 'Contains 911.', test: c => c.s.includes('911') },
  { id: 'HELL', label: 'Hell', emoji: '🔥', fam: 'HELL', desc: 'Contains 7734 — "hELL" on a flipped calculator.', test: c => c.s.includes('7734') },
  { id: 'BOOB', label: 'Boob', emoji: '🍒', fam: 'BOOB', desc: 'Contains 8008.', test: c => c.s.includes('8008') },
  { id: 'BOOB_58008', label: 'Boobies', emoji: '🍈', fam: 'BOOB', desc: 'Contains 58008.', test: c => c.s.includes('58008') },
  { id: 'BIG_BROTHER', label: 'Big Brother', emoji: '📺', fam: 'BIG_BROTHER', desc: 'Contains 1984.', test: c => c.s.includes('1984') },
  { id: 'TREE_FIDDY', label: 'Tree Fiddy', emoji: '🦖', fam: 'TREE_FIDDY', desc: 'Contains 350.', test: c => c.s.includes('350') },
  { id: 'SIXTY_SEVEN', label: 'Six-Seven', emoji: '😵‍💫', fam: 'SIXTY_SEVEN', desc: 'Contains 67.', test: c => c.s.includes('67') },
  { id: 'SIXTY_SEVEN_DOUBLE', label: 'Double Six-Seven', emoji: '🤯', fam: 'SIXTY_SEVEN', desc: 'Contains 6767.', test: c => c.s.includes('6767') },
  { id: 'BRAINROT', label: 'Brainrot', emoji: '🧠', fam: 'SIXTY_SEVEN', desc: 'Contains 676767.', test: c => c.s.includes('676767') },
  { id: 'EIGHTY_SIX', label: 'Eighty-Six', emoji: '🍴', fam: 'EIGHTY_SIX', desc: 'Contains 86.', test: c => c.s.includes('86') },
  { id: 'ERROR', label: 'Not Found', emoji: '❓', fam: 'ERROR', desc: 'Contains 404.', test: c => c.s.includes('404') },
  { id: 'ULTIMEME', label: 'Ultimeme', emoji: '🎴', fam: 'ULTIMEME', desc: 'Contains both 69 and 420.', test: c => c.s.includes('69') && c.s.includes('420') },

  // --- Jackpot / sevens ---------------------------------------------------
  { id: 'JACKPOT', label: 'Jackpot', emoji: '🎰', fam: 'JACKPOT', desc: 'Contains 777.', test: c => c.s.includes('777') },
  { id: 'JACKPOT_FOUR', label: 'Jackpot Four', emoji: '🎲', fam: 'JACKPOT', desc: 'Contains 7777.', test: c => c.s.includes('7777') },
  { id: 'JACKPOT_FIVE', label: 'Jackpot Five', emoji: '🏆', fam: 'JACKPOT', desc: 'Contains 77777.', test: c => c.s.includes('77777') },
  { id: 'JACKPOT_SIX', label: 'Jackpot Six', emoji: '🏦', fam: 'JACKPOT', desc: 'Contains 777777.', test: c => c.s.includes('777777') },
  { id: 'LUCKY_SEVEN', label: 'Lucky Seven', emoji: '🍀', fam: null, desc: 'Contains at least one 7.', test: c => c.counts[7] > 0 },

  // --- Constants: digits of pi, e, tau ------------------------------------
  { id: 'PI_3', label: 'Pi Slice', emoji: '🔺', fam: 'PI', desc: 'Contains 314.', test: c => c.s.includes('314') },
  { id: 'PI_4', label: 'Pi Wedge', emoji: '🍕', fam: 'PI', desc: 'Contains 3141.', test: c => c.s.includes('3141') },
  { id: 'PI_5', label: 'Pi Half', emoji: '🥮', fam: 'PI', desc: 'Contains 31415.', test: c => c.s.includes('31415') },
  { id: 'E_3', label: 'e Slice', emoji: '📈', fam: 'E', desc: 'Contains 271.', test: c => c.s.includes('271') },
  { id: 'E_4', label: 'e Wedge', emoji: '📊', fam: 'E', desc: 'Contains 2718.', test: c => c.s.includes('2718') },
  { id: 'E_5', label: 'e Half', emoji: '🧊', fam: 'E', desc: 'Contains 27182.', test: c => c.s.includes('27182') },
  { id: 'TAU_4', label: 'Tau Wedge', emoji: '🎡', fam: 'TAU', desc: 'Contains 6283.', test: c => c.s.includes('6283') },
  { id: 'TAU_5', label: 'Tau Half', emoji: '🎢', fam: 'TAU', desc: 'Contains 62831.', test: c => c.s.includes('62831') },

  // --- Poker-shaped digit patterns ---------------------------------------
  { id: 'PAIR', label: 'Pair', emoji: '👯', fam: 'PAIRS', desc: 'Some digit appears at least twice.', test: c => c.maxCount >= 2 },
  { id: 'TWO_PAIR', label: 'Two Pair', emoji: '👨‍👩‍👦', fam: 'PAIRS', desc: 'Two digits each appear exactly twice.', test: c => exactly(c, 2) >= 2 },
  { id: 'THREE_PAIR', label: 'Three Pair', emoji: '👨‍👩‍👧‍👦', fam: 'PAIRS', desc: 'Three digits each appear exactly twice.', test: c => exactly(c, 2) >= 3 },
  { id: 'CONTIGUOUS_PAIR', label: 'Adjacent Pair', emoji: '🤝', fam: 'PAIRS', desc: 'Two identical digits sit side by side.', test: c => longestRun(c) >= 2 },
  { id: 'CONTIGUOUS_TWO_PAIR', label: 'Adjacent Two Pair', emoji: '🧑‍🤝‍🧑', fam: 'PAIRS', desc: 'Two separate side-by-side doubles.', test: c => doubleRuns(c) >= 2 },
  { id: 'CONTIGUOUS_THREE_PAIR', label: 'Adjacent Three Pair', emoji: '🫂', fam: 'PAIRS', desc: 'Three separate side-by-side doubles.', test: c => doubleRuns(c) >= 3 },
  { id: 'TRIPS', label: 'Three of a Kind', emoji: '🎯', fam: 'OF_A_KIND', desc: 'Some digit appears exactly three times.', test: c => exactly(c, 3) > 0 },
  { id: 'QUADS', label: 'Four of a Kind', emoji: '🍀', fam: 'OF_A_KIND', desc: 'Some digit appears exactly four times.', test: c => exactly(c, 4) > 0 },
  { id: 'FIVE_OF_A_KIND', label: 'Five of a Kind', emoji: '🖐️', fam: 'OF_A_KIND', desc: 'Some digit appears exactly five times.', test: c => exactly(c, 5) > 0 },
  { id: 'SIX_OF_A_KIND', label: 'Six of a Kind', emoji: '🌟', fam: 'OF_A_KIND', desc: 'Some digit appears six times.', test: c => exactly(c, 6) > 0 },
  { id: 'CONTIGUOUS_TRIPS', label: 'Triple Run', emoji: '🧱', fam: 'CONTIGUOUS_RUN', desc: 'Three identical digits in a row.', test: c => longestRun(c) >= 3 },
  { id: 'CONTIGUOUS_QUADS', label: 'Quad Run', emoji: '🏗️', fam: 'CONTIGUOUS_RUN', desc: 'Four identical digits in a row.', test: c => longestRun(c) >= 4 },
  { id: 'CONTIGUOUS_FIVES', label: 'Quint Run', emoji: '🗼', fam: 'CONTIGUOUS_RUN', desc: 'Five identical digits in a row.', test: c => longestRun(c) >= 5 },
  { id: 'CONTIGUOUS_SIXES', label: 'Monolith', emoji: '🗿', fam: 'CONTIGUOUS_RUN', desc: 'Six identical digits in a row.', test: c => longestRun(c) >= 6 },
  { id: 'BOAT', label: 'Full House', emoji: '🏠', fam: 'BOAT', desc: 'A three of a kind and a pair.', test: c => exactly(c, 3) > 0 && exactly(c, 2) > 0 },
  { id: 'CONTIGUOUS_BOAT', label: 'Packed House', emoji: '🏘️', fam: 'BOAT', desc: 'A triple run and a double run, both contiguous.', test: c => c.runs.filter(r => r >= 3).length > 0 && c.runs.filter(r => r === 2).length > 0 },
  { id: 'RAINBOW', label: 'Rainbow', emoji: '🌈', fam: null, desc: 'Every digit is different.', test: c => c.distinct === c.len && c.len >= 4 },
  { id: 'DUALITY', label: 'Duality', emoji: '☯️', fam: 'DUALITY', desc: 'Built from exactly two distinct digits.', test: c => c.distinct === 2 && c.len >= 4 },
  { id: 'FIREFLY', label: 'Firefly', emoji: '🪰', fam: 'DUALITY', desc: 'Two digits alternating perfectly.', test: c => isAlternating(c) },

  // --- Straights and ladders ---------------------------------------------
  { id: 'SEQUENCE_3', label: 'Sequence', emoji: '🪜', fam: 'PROGRESSION', desc: 'Three consecutive digits in a row, up or down.', test: c => longestLadder(c) >= 3 },
  { id: 'SEQUENCE_4', label: 'Long Sequence', emoji: '🧗', fam: 'PROGRESSION', desc: 'Four consecutive digits in a row.', test: c => longestLadder(c) >= 4 },
  { id: 'STRAIGHT', label: 'Straight', emoji: '➡️', fam: 'PROGRESSION', desc: 'Five consecutive digits in a row.', test: c => longestLadder(c) >= 5 },
  { id: 'SEQUENCE_6', label: 'Perfect Straight', emoji: '🚀', fam: 'PROGRESSION', desc: 'All six digits consecutive.', test: c => c.len === 6 && longestLadder(c) === 6 },
  { id: 'SCRAMBLE', label: 'Scramble', emoji: '🔀', fam: 'PROGRESSION', desc: 'The digits are a shuffled run of consecutive values.', test: c => isScramble(c) },
  { id: 'ARITHMETIC', label: 'Arithmetic', emoji: '➕', fam: 'PROGRESSION', desc: 'Digits step by a constant amount.', test: c => isArithmetic(c) },
  { id: 'GEOMETRIC', label: 'Geometric', emoji: '✖️', fam: 'PROGRESSION', desc: 'Each digit is a fixed multiple of the last.', test: c => isGeometric(c) },
  { id: 'ASCENSION', label: 'Ascension', emoji: '📈', fam: 'MONOTONIC', desc: 'Digits strictly increase.', test: c => monotonic(c, true, true) },
  { id: 'DECAY', label: 'Decay', emoji: '📉', fam: 'MONOTONIC', desc: 'Digits strictly decrease.', test: c => monotonic(c, false, true) },
  { id: 'STEPS', label: 'Steps', emoji: '🪜', fam: 'MONOTONIC', desc: 'Digits never decrease, but repeat somewhere.', test: c => monotonic(c, true, false) },
  { id: 'SLOPES', label: 'Slopes', emoji: '⛷️', fam: 'MONOTONIC', desc: 'Digits never increase, but repeat somewhere.', test: c => monotonic(c, false, false) },

  // --- Terrain ------------------------------------------------------------
  { id: 'MOUNTAIN', label: 'Mountain', emoji: '⛰️', fam: 'PEAK', desc: 'Rises to one peak, then falls.', test: c => isPeak(c, true) },
  { id: 'VALLEY', label: 'Valley', emoji: '🏞️', fam: 'PEAK', desc: 'Falls to one low point, then rises.', test: c => isPeak(c, false) },
  { id: 'MESA', label: 'Mesa', emoji: '🏜️', fam: 'PEAK', desc: 'Rises to a flat top, then falls.', test: c => isPlateau(c, true) },
  { id: 'CANYON', label: 'Canyon', emoji: '🪨', fam: 'PEAK', desc: 'Falls to a flat floor, then rises.', test: c => isPlateau(c, false) },
  { id: 'HOPSCOTCH', label: 'Hopscotch', emoji: '🦘', fam: 'HOPSCOTCH', desc: 'Digits alternate up, down, up, down.', test: c => {
      if (c.len < 4) return false;
      for (let i = 1; i < c.len; i++) {
        const rising = c.d[i] > c.d[i - 1], falling = c.d[i] < c.d[i - 1];
        if (!rising && !falling) return false;
        if (i > 1 && rising === (c.d[i - 1] > c.d[i - 2])) return false;
      }
      return true;
    } },

  // --- Symmetry -----------------------------------------------------------
  { id: 'PALINDROME', label: 'Palindrome', emoji: '🪞', fam: 'PALINDROME', desc: 'Reads the same backwards.', test: c => isPalindrome(c.s) },
  { id: 'POCKET_MIRROR', label: 'Pocket Mirror', emoji: '🔍', fam: 'PALINDROME', desc: 'Contains a three-digit palindrome.', test: c => hasPalindromeOfLength(c, 3) },
  { id: 'BOOKENDS', label: 'Bookends', emoji: '📚', fam: 'BOOKENDS', desc: 'Starts and ends on the same digit.', test: c => c.len >= 3 && c.d[0] === c.d[c.len - 1] },
  { id: 'PAIRED_BOOKENDS', label: 'Paired Bookends', emoji: '🗄️', fam: 'BOOKENDS', desc: 'Opens and closes with the same two digits.', test: c => c.len >= 5 && c.s.slice(0, 2) === c.s.slice(-2) },
  { id: 'ORIENTATION', label: 'Orientation', emoji: '🔄', fam: 'ORIENTATION', desc: 'Every digit is readable upside down.', test: c => digitsIn(c, new Set([0, 1, 6, 8, 9])) },
  { id: 'ORIENTATION_EXACT', label: 'Strobogrammatic', emoji: '🙃', fam: 'ORIENTATION', desc: 'Reads as the same number upside down.', test: c => isStrobogrammatic(c) },
  { id: 'RHYME', label: 'Rhyme', emoji: '🎵', fam: 'REPEAT', desc: 'A block of digits repeated twice, e.g. 348348.', test: c => isRepeatedBlock(c, 2) },
  { id: 'MINI_ECHO', label: 'Echo', emoji: '📣', fam: 'REPEAT', desc: 'A block of digits repeated three times, e.g. 232323.', test: c => isRepeatedBlock(c, 3) },
  { id: 'EQUILIBRIUM', label: 'Equilibrium', emoji: '⚖️', fam: 'EQUILIBRIUM', desc: 'Both halves have the same digit sum.', test: c => {
      if (c.len % 2 !== 0) return false;
      const h = c.len / 2;
      let a = 0, b = 0;
      for (let i = 0; i < h; i++) { a += c.d[i]; b += c.d[i + h]; }
      return a === b;
    } },
  { id: 'SANDWICH', label: 'Sandwich', emoji: '🥪', fam: 'EQUILIBRIUM', desc: 'Symmetric outer digits around a different core.', test: c => c.len >= 5 && c.d[0] === c.d[c.len - 1] && c.d[1] === c.d[c.len - 2] && c.d[0] !== c.d[1] },

  // --- Zeros --------------------------------------------------------------
  { id: 'DEEP_VOID', label: 'Void', emoji: '🕳️', fam: 'VOID_DEPTH', desc: 'Two zeros in a row.', test: c => c.s.includes('00') },
  { id: 'DEEP_VOID_THREE', label: 'Deep Void', emoji: '🌑', fam: 'VOID_DEPTH', desc: 'Three zeros in a row.', test: c => c.s.includes('000') },
  { id: 'DEEP_VOID_FOUR', label: 'Deeper Void', emoji: '🌚', fam: 'VOID_DEPTH', desc: 'Four zeros in a row.', test: c => c.s.includes('0000') },
  { id: 'DEEP_VOID_FIVE', label: 'Abyss', emoji: '🌀', fam: 'VOID_DEPTH', desc: 'Five zeros in a row.', test: c => c.s.includes('00000') },
  { id: 'CLEAN_HUNDRED', label: 'Clean Hundred', emoji: '💯', fam: 'CLEAN', desc: 'Ends in 00.', test: c => c.n % 100 === 0 },
  { id: 'CLEAN_THOUSAND', label: 'Clean Thousand', emoji: '🧼', fam: 'CLEAN', desc: 'Ends in 000.', test: c => c.n % 1000 === 0 },
  { id: 'CLEAN_TEN_THOUSAND', label: 'Very Clean', emoji: '🫧', fam: 'CLEAN', desc: 'Ends in 0000.', test: c => c.n % 10000 === 0 },
  { id: 'CLEAN_HUNDRED_THOUSAND', label: 'Immaculate', emoji: '✨', fam: 'CLEAN', desc: 'Ends in 00000.', test: c => c.n % 100000 === 0 },

  // --- Nine endings -------------------------------------------------------
  { id: 'DOUBLE_NINE', label: 'Double Nine', emoji: '🛒', fam: 'NINE_ENDING', desc: 'Ends in 99.', test: c => c.n % 100 === 99 },
  { id: 'TRIPLE_NINE', label: 'Triple Nine', emoji: '🏷️', fam: 'NINE_ENDING', desc: 'Ends in 999.', test: c => c.n % 1000 === 999 },
  { id: 'QUAD_NINE', label: 'Quad Nine', emoji: '💸', fam: 'NINE_ENDING', desc: 'Ends in 9999.', test: c => c.n % 10000 === 9999 },
  { id: 'QUINT_NINE', label: 'Quint Nine', emoji: '🤑', fam: 'NINE_ENDING', desc: 'Ends in 99999.', test: c => c.n % 100000 === 99999 },

  // --- Number theory ------------------------------------------------------
  { id: 'PRIME', label: 'Prime', emoji: '💎', fam: null, desc: 'Divisible only by itself and one.', test: c => isPrime(c.n) },
  { id: 'TWIN_PRIME', label: 'Twin Prime', emoji: '👬', fam: null, desc: 'Prime, and two away from another prime.', test: c => isPrime(c.n) && (isPrime(c.n - 2) || (c.n + 2 <= ROLL_MAX && isPrime(c.n + 2))) },
  { id: 'PALINDROMIC_PRIME', label: 'Palindromic Prime', emoji: '🔮', fam: null, desc: 'Prime and a palindrome.', test: c => isPrime(c.n) && isPalindrome(c.s) },
  { id: 'SQUARE', label: 'Perfect Square', emoji: '⬜', fam: 'POWER', desc: 'A whole number squared.', test: c => POWERS[2].has(c.n) },
  { id: 'CUBE', label: 'Perfect Cube', emoji: '🧊', fam: 'POWER', desc: 'A whole number cubed.', test: c => POWERS[3].has(c.n) },
  { id: 'FOURTH_POWER', label: 'Fourth Power', emoji: '🎁', fam: 'POWER', desc: 'A whole number to the fourth.', test: c => POWERS[4].has(c.n) },
  { id: 'FIFTH_POWER', label: 'Fifth Power', emoji: '⭐', fam: 'POWER', desc: 'A whole number to the fifth.', test: c => POWERS[5].has(c.n) },
  { id: 'SIXTH_POWER', label: 'Sixth Power', emoji: '❄️', fam: 'POWER', desc: 'A whole number to the sixth.', test: c => POWERS[6].has(c.n) },
  { id: 'SEVENTH_POWER', label: 'Seventh Power', emoji: '🌟', fam: 'POWER', desc: 'A whole number to the seventh.', test: c => POWERS[7].has(c.n) },
  { id: 'EIGHTH_POWER', label: 'Eighth Power', emoji: '🕸️', fam: 'POWER', desc: 'A whole number to the eighth.', test: c => POWERS[8].has(c.n) },
  { id: 'NINTH_POWER', label: 'Ninth Power', emoji: '🌌', fam: 'POWER', desc: 'A whole number to the ninth.', test: c => POWERS[9].has(c.n) },
  { id: 'TENTH_POWER', label: 'Tenth Power', emoji: '🛸', fam: 'POWER', desc: 'A whole number to the tenth.', test: c => POWERS[10].has(c.n) },
  { id: 'POWER_OF_TWO', label: 'Power of Two', emoji: '💾', fam: 'BASE_POWER', desc: 'A power of two.', test: c => POW2.has(c.n) },
  { id: 'POWER_OF_THREE', label: 'Power of Three', emoji: '🔱', fam: 'BASE_POWER', desc: 'A power of three.', test: c => POW3.has(c.n) },
  { id: 'POWER_OF_FIVE', label: 'Power of Five', emoji: '🖐️', fam: 'BASE_POWER', desc: 'A power of five.', test: c => POW5.has(c.n) },
  { id: 'POWER_OF_SEVEN', label: 'Power of Seven', emoji: '🎰', fam: 'BASE_POWER', desc: 'A power of seven.', test: c => POW7.has(c.n) },
  { id: 'POWER_OF_TEN', label: 'Power of Ten', emoji: '🔟', fam: 'BASE_POWER', desc: 'A power of ten.', test: c => POW10.has(c.n) },
  { id: 'FIBONACCI', label: 'Fibonacci', emoji: '🐚', fam: null, desc: 'A Fibonacci number.', test: c => FIB.has(c.n) },
  { id: 'TRIANGULAR', label: 'Triangular', emoji: '🔺', fam: null, desc: 'A triangular number.', test: c => TRIANGULAR.has(c.n) },
  { id: 'FACTORIAL', label: 'Factorial', emoji: '❗', fam: null, desc: 'A factorial.', test: c => FACTORIAL.has(c.n) },
  { id: 'PERFECT_NUMBER', label: 'Perfect Number', emoji: '🏅', fam: null, desc: 'Equal to the sum of its proper divisors.', test: c => PERFECT.has(c.n) },
  { id: 'REPDIGIT', label: 'Repdigit', emoji: '🧿', fam: null, desc: 'The same digit all the way through.', test: c => REPDIGIT.has(c.n) && c.len >= 2 },
  { id: 'SPY', label: 'Spy', emoji: '🕵️', fam: null, desc: 'Digit sum equals digit product.', test: c => c.len >= 2 && c.sum === c.prod },
  { id: 'EQUATION', label: 'Equation', emoji: '🟰', fam: null, desc: 'The last digit is the sum of all the others.', test: c => c.len >= 3 && c.sum - c.d[c.len - 1] === c.d[c.len - 1] },
  { id: 'HARSHAD', label: 'Harshad', emoji: '🧮', fam: null, desc: 'Divisible by its own digit sum.', test: c => c.n > 0 && c.n % c.sum === 0 },

  // --- Digit composition --------------------------------------------------
  { id: 'ALL_EVEN', label: 'All Even', emoji: '🟦', fam: null, desc: 'Every digit is even.', test: c => c.len >= 3 && c.d.every(v => v % 2 === 0) },
  { id: 'ALL_ODD', label: 'All Odd', emoji: '🟥', fam: null, desc: 'Every digit is odd.', test: c => c.len >= 3 && c.d.every(v => v % 2 === 1) },
  { id: 'ALL_PRIME_DIGITS', label: 'Prime Digits', emoji: '💠', fam: null, desc: 'Every digit is 2, 3, 5 or 7.', test: c => c.len >= 3 && digitsIn(c, new Set([2, 3, 5, 7])) },
  { id: 'BINARY', label: 'Binary', emoji: '🤖', fam: null, desc: 'Written with only 0 and 1.', test: c => c.len >= 3 && digitsIn(c, new Set([0, 1])) },
  { id: 'LOWLANDS', label: 'Lowlands', emoji: '🐜', fam: null, desc: 'Every digit is 3 or less.', test: c => c.len >= 4 && c.d.every(v => v <= 3) },
  { id: 'HIGHLANDS', label: 'Highlands', emoji: '🦅', fam: null, desc: 'Every digit is 6 or more.', test: c => c.len >= 4 && c.d.every(v => v >= 6) },
  { id: 'HEAVY', label: 'Heavy', emoji: '🏋️', fam: 'WEIGHT', desc: 'Digits sum to 40 or more.', test: c => c.sum >= 40 },
  { id: 'FEATHERWEIGHT', label: 'Featherweight', emoji: '🪶', fam: 'WEIGHT', desc: 'Six digits summing to 6 or less.', test: c => c.len === 6 && c.sum <= 6 },
  { id: 'CALENDAR', label: 'Calendar', emoji: '📅', fam: 'CALENDAR', desc: 'Reads as a valid DDMMYY date.', test: c => isCalendar(c) },
  // A six-digit roll can never start with a leading zero, so 02/02 can only
  // show up mid-number rather than as the leading DDMM.
  { id: 'GROUNDHOG_DAY', label: 'Groundhog Day', emoji: '🦫', fam: 'CALENDAR', desc: 'Contains 0202 — the 2nd of February, again.', test: c => c.s.includes('0202') },

  // --- Baseline -----------------------------------------------------------
  { id: 'EVEN', label: 'Even', emoji: '⚖️', fam: 'PARITY', desc: 'An even number.', test: c => c.n % 2 === 0 },
  { id: 'ODD', label: 'Odd', emoji: '🦄', fam: 'PARITY', desc: 'An odd number.', test: c => c.n % 2 === 1 },
  { id: 'ONE_DIGIT', label: 'One Digit', emoji: '🔹', fam: 'SINGLE_DIGIT', desc: 'A single-digit roll.', test: c => c.len === 1 },
  { id: 'TWO_DIGITS', label: 'Two Digits', emoji: '🔸', fam: 'LENGTH', desc: 'A two-digit roll.', test: c => c.len === 2 },
  { id: 'THREE_DIGITS', label: 'Three Digits', emoji: '🔶', fam: 'LENGTH', desc: 'A three-digit roll.', test: c => c.len === 3 },
  { id: 'FOUR_DIGITS', label: 'Four Digits', emoji: '🔷', fam: 'LENGTH', desc: 'A four-digit roll.', test: c => c.len === 4 },
  { id: 'FIVE_DIGITS', label: 'Five Digits', emoji: '🟣', fam: 'LENGTH', desc: 'A five-digit roll.', test: c => c.len === 5 },
  { id: 'SIX_DIGITS', label: 'Six Digits', emoji: '🐝', fam: 'LENGTH', desc: 'A six-digit roll.', test: c => c.len === 6 },
];

/** Human-readable names for the supersession families. */
export const FAMILY_NAMES = {
  NICE: 'Nice', JACKPOT: 'Jackpot', BOTANIST: 'Botanist', DEVIL: 'Devil', LEET: 'Leet',
  MEANING: 'Meaning', EMERGENCY: 'Emergency', HELL: 'Hell', BOOB: 'Boob',
  BIG_BROTHER: 'Big Brother', TREE_FIDDY: 'Tree Fiddy', SIXTY_SEVEN: 'Six-Seven',
  EIGHTY_SIX: 'Eighty-Six', ERROR: 'Error', ULTIMEME: 'Ultimeme', PI: 'Pi', E: 'E',
  TAU: 'Tau', SINGLE_DIGIT: 'Single Digit', PAIRS: 'Pairs', OF_A_KIND: 'Of a Kind',
  CONTIGUOUS_RUN: 'Contiguous Run', BOAT: 'Full House', DUALITY: 'Duality',
  PROGRESSION: 'Progression', MONOTONIC: 'Monotonic', PEAK: 'Terrain',
  HOPSCOTCH: 'Hopscotch', PALINDROME: 'Palindrome', BOOKENDS: 'Bookends',
  ORIENTATION: 'Orientation', REPEAT: 'Repeat', EQUILIBRIUM: 'Equilibrium',
  VOID_DEPTH: 'Void Depth', CLEAN: 'Clean Ending', NINE_ENDING: 'Nine Ending',
  POWER: 'Perfect Power', BASE_POWER: 'Power Of', WEIGHT: 'Weight',
  CALENDAR: 'Calendar', PARITY: 'Parity', LENGTH: 'Length',
};

if (new Set(BADGES.map(b => b.id)).size !== BADGES.length) {
  throw new Error('duplicate badge id in BADGES');
}
