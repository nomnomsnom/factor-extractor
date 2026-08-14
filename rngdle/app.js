// RNGdle UI: rolling, auto-roll, collection tracking, local stats.
// All game rules live in engine.js — nothing here decides what a roll is worth.

import {
  analyze, scan, roll, hitBuffer, cardRarity, shareText,
  CATALOGUE, BADGE_IDS, BADGE_COUNT, RARITY_ORDER, ROLL_MAX,
} from './engine.js';

const STORE_KEY = 'rngdle.v2';
const TOP_N = 50;

const $ = id => document.getElementById(id);
const fmt = n => Math.round(n).toLocaleString('en-US');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const blankState = () => ({
  rolls: 0,
  lifetimeEP: 0,
  best: null,   // { n, ep, rarity }
  found: [],    // badge ids ever earned
  top: [],      // best rolls, newest sort applied lazily
});

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? { ...blankState(), ...JSON.parse(raw) } : blankState();
  } catch {
    // Private mode, disabled storage, or corrupt JSON: play unsaved rather than break.
    return blankState();
  }
}

let state = load();

let saveTimer = 0;
/** Debounced: auto-roll can fire thousands of times a second. */
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}
function saveNow() {
  clearTimeout(saveTimer);
  trimTop();
  state.found = [...foundBits.entries()].filter(([, v]) => v).map(([i]) => BADGE_IDS[i]);
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch { /* nothing we can do; the session still plays */ }
}

// Collection as a flat bitmap for the hot path, rehydrated from stored ids.
const INDEX_OF = new Map(BADGE_IDS.map((id, i) => [id, i]));
const foundBits = new Uint8Array(BADGE_COUNT);
for (const id of state.found) {
  const i = INDEX_OF.get(id);
  if (i !== undefined) foundBits[i] = 1; // unknown ids are from an older badge set
}
const foundCount = () => foundBits.reduce((a, b) => a + b, 0);

// Keep only the best rolls, deduped by number.
let topFloor = 0;
function trimTop() {
  const seen = new Set();
  state.top = state.top
    .sort((a, b) => b.ep - a.ep)
    .filter(r => !seen.has(r.n) && seen.add(r.n))
    .slice(0, TOP_N);
  topFloor = state.top.length >= TOP_N ? state.top[TOP_N - 1].ep : 0;
}
trimTop();

/** Fold one roll into the running totals. Hot: called once per auto-roll. */
function record(n, ep, rarity) {
  state.rolls++;
  state.lifetimeEP += ep;
  if (!state.best || ep > state.best.ep) state.best = { n, ep, rarity };
  if (state.top.length < TOP_N || ep > topFloor) {
    state.top.push({ n, ep, rarity });
    if (state.top.length > TOP_N * 2) trimTop();
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderScoreboard() {
  $('stat-rolls').textContent = fmt(state.rolls);
  $('stat-lifetime').textContent = fmt(state.lifetimeEP);
  $('stat-best').textContent = state.best ? fmt(state.best.n) : '—';
  $('stat-found').textContent = `${foundCount()}/${BADGE_COUNT}`;
}

/** "1 in 14,493" reads better than a probability for anything this rare. */
function oddsLabel(chance) {
  if (chance >= 0.1) return `${(chance * 100).toFixed(1)}% of rolls`;
  return `1 in ${fmt(1 / chance)}`;
}

function badgeCard(b, i) {
  const el = document.createElement('div');
  el.className = `badge r-${b.rarity}${b.scored ? '' : ' is-muted'}${b.isNew ? ' is-new' : ''}`;
  el.style.animationDelay = `${Math.min(i, 20) * 24}ms`;
  el.innerHTML = `
    <span class="glyph">${b.emoji}</span>
    <span class="body">
      <span class="name">${b.label}${b.isNew ? '<em class="new">new</em>' : ''}</span>
      <span class="meta">${b.scored ? `+${fmt(b.ep)} EP` : `covered by ${b.coveredBy}`}</span>
    </span>`;
  el.title = `${b.desc}  ·  ${b.rarity}  ·  ${oddsLabel(b.chance)}`;
  return el;
}

/** A short human read on the roll, keyed off its best badge. */
function oneLiner(result) {
  const scored = result.badges.filter(b => b.scored);
  const top = scored[0];
  if (!top) return 'A number with nothing to say.';
  if (result.rarity === 'Common') return `Mostly quiet. Your best find: ${top.label.toLowerCase()}.`;
  const rest = scored.length - 1;
  return `${top.label} — ${oddsLabel(top.chance)}.` +
    (rest > 0 ? ` Plus ${rest} more badge${rest === 1 ? '' : 's'}.` : '');
}

/** Full result render. Not called per-roll while auto-rolling — too expensive. */
function renderResult(result, newIndexes = null) {
  $('prompt').hidden = true;
  $('result').hidden = false;
  $('share-btn').hidden = false;

  setNumber(result.n, result.totalEP, result.rarity);
  $('oneliner').textContent = oneLiner(result);

  const badges = newIndexes
    ? result.badges.map(b => ({ ...b, isNew: newIndexes.has(b.index) }))
    : result.badges;
  $('badge-list').replaceChildren(...badges.map(badgeCard));

  $('stage').className = `stage glow-${result.rarity}`;
}

/** Cheap per-frame update: just the headline numbers. */
function setNumber(n, ep, rarity) {
  $('number').textContent = fmt(n);
  $('ep').textContent = fmt(ep);
  const pill = $('rarity');
  pill.textContent = rarity;
  pill.className = `pill r-${rarity}`;
}

/** Spin through decoys before landing, so a hand roll has a beat to it. */
function revealNumber(done) {
  const el = $('number');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { done(); return; }

  el.classList.add('is-rolling');
  const start = performance.now();
  const DURATION = 620;

  (function tick(now) {
    const t = (now - start) / DURATION;
    if (t >= 1) { el.classList.remove('is-rolling'); done(); return; }
    el.textContent = fmt(Math.floor(Math.random() * (ROLL_MAX + 1)));
    // Ease out: frames get further apart as it settles.
    setTimeout(() => requestAnimationFrame(tick), 26 + t * t * 130);
  })(start);
}

// ---------------------------------------------------------------------------
// Rolling by hand
// ---------------------------------------------------------------------------

const hits = hitBuffer();

/** Mark newly-earned badges as collected. Returns the indexes that were new. */
function collect(buffer) {
  const fresh = [];
  for (let i = 0; i < BADGE_COUNT; i++) {
    if (buffer[i] && !foundBits[i]) { foundBits[i] = 1; fresh.push(i); }
  }
  return fresh;
}

function rollOnce() {
  stopAuto();
  const n = roll();
  const result = analyze(n, hits); // analyze fills `hits` as a side effect
  const fresh = collect(hits);

  record(n, result.totalEP, result.rarity);
  saveSoon();

  revealNumber(() => {
    renderResult(result, new Set(fresh));
    renderScoreboard();
    renderCatalogue();
    renderHistory();
    if (fresh.length) toast(`New badge: ${CATALOGUE.find(b => b.index === fresh[0]).label}`);
  });
}

// ---------------------------------------------------------------------------
// Auto-roll
// ---------------------------------------------------------------------------

// Slow is one visible roll at a time. Fast is a fixed batch per frame. Turbo
// rolls until it has spent its frame budget, so it scales with the machine
// instead of locking up a slow one.
const SPEEDS = {
  slow: { perFrame: 1, minDelay: 120 },
  fast: { perFrame: 25, minDelay: 0 },
  turbo: { budgetMs: 10, chunk: 64 },
};

const auto = {
  on: false, raf: 0, last: 0, lastSave: 0,
  count: 0, bestEP: 0, bestN: 0,
  fresh: [], lastN: 0, lastEP: 0, lastRarity: 'Common',
  stopped: null,
};

function stopCondition() {
  const mode = $('stop-select').value;
  if (mode === 'none') return { mode, hit: () => false };
  if (mode === 'new') return { mode, hit: (rarity, isNew) => isNew };
  const floor = RARITY_ORDER.indexOf(mode);
  return { mode, hit: rarity => RARITY_ORDER.indexOf(rarity) >= floor };
}

/**
 * Roll `count` times. Returns true when a stop condition fired, leaving the
 * triggering roll in auto.stopped.
 */
function autoBatch(count, stop, limit) {
  for (let k = 0; k < count; k++) {
    const n = roll();
    const ep = scan(n, hits);
    const rarity = cardRarity(ep);

    let isNew = false;
    for (let i = 0; i < BADGE_COUNT; i++) {
      if (hits[i] && !foundBits[i]) { foundBits[i] = 1; auto.fresh.push(i); isNew = true; }
    }

    record(n, ep, rarity);
    auto.count++;
    auto.lastN = n; auto.lastEP = ep; auto.lastRarity = rarity;
    if (ep > auto.bestEP) { auto.bestEP = ep; auto.bestN = n; }

    // The reason is whichever condition the player armed — not whether this roll
    // happened to also be a new badge, which would mislabel a rarity stop.
    if (stop.hit(rarity, isNew)) { auto.stopped = { n, reason: stop.mode === 'new' ? 'new' : 'rarity' }; return true; }
    if (limit && auto.count >= limit) { auto.stopped = { n, reason: 'limit' }; return true; }
  }
  return false;
}

function autoFrame(ts) {
  if (!auto.on) return;

  const spec = SPEEDS[$('speed-select').value] || SPEEDS.fast;
  const limit = Number($('limit-select').value) || 0;
  const stop = stopCondition();
  let done = false;

  if (spec.budgetMs) {
    const start = performance.now();
    do { done = autoBatch(spec.chunk, stop, limit); }
    while (!done && performance.now() - start < spec.budgetMs);
  } else if (spec.minDelay && ts - auto.last < spec.minDelay) {
    auto.raf = requestAnimationFrame(autoFrame);
    return;
  } else {
    auto.last = ts;
    done = autoBatch(spec.perFrame, stop, limit);
  }

  paintAuto();

  if (done) { finishAuto(); return; }

  // An unlimited turbo run can go for minutes; checkpoint it so a crashed tab
  // doesn't cost the whole session.
  if (ts - auto.lastSave > 3000) { auto.lastSave = ts; saveNow(); }

  auto.raf = requestAnimationFrame(autoFrame);
}

/** Per-frame paint: counters plus the headline, but never the badge grid. */
function paintAuto() {
  $('auto-count').textContent = fmt(auto.count);
  $('auto-best').textContent = fmt(auto.bestEP);
  $('prompt').hidden = true;
  $('result').hidden = false;
  setNumber(auto.lastN, auto.lastEP, auto.lastRarity);
  renderScoreboard();
}

function startAuto() {
  if (auto.on) return;
  Object.assign(auto, {
    on: true, count: 0, bestEP: 0, bestN: 0, fresh: [], stopped: null,
    last: 0, lastSave: performance.now(),
  });

  $('auto-btn').textContent = 'Stop';
  $('auto-btn').classList.add('is-on');
  $('auto-btn').setAttribute('aria-pressed', 'true');
  $('auto-live').hidden = false;
  $('auto-dot').hidden = false;
  $('auto-found').hidden = true;
  $('auto-status').textContent = 'Rolling…';
  $('roll-btn').disabled = true;
  $('badge-list').replaceChildren();
  $('stage').className = 'stage'; // drop the previous card's glow for the run

  auto.raf = requestAnimationFrame(autoFrame);
}

function stopAuto() {
  if (!auto.on) return;
  auto.on = false;
  cancelAnimationFrame(auto.raf);
  $('auto-btn').textContent = 'Auto-roll';
  $('auto-btn').classList.remove('is-on');
  $('auto-btn').setAttribute('aria-pressed', 'false');
  $('auto-dot').hidden = true; // the run summary stays; the live pulse should not
  $('roll-btn').disabled = false;
  saveNow();
  renderScoreboard();
  renderCatalogue();
  renderHistory();
}

/** A run ended on its own: show the roll that ended it, in full. */
function finishAuto() {
  const { n, reason } = auto.stopped ?? { n: auto.lastN, reason: 'limit' };
  const fresh = new Set(auto.fresh);
  stopAuto();

  renderResult(analyze(n), fresh);
  $('auto-status').textContent = {
    new: 'Stopped — new badge found',
    rarity: 'Stopped — rarity hit',
    limit: 'Stopped — roll limit reached',
  }[reason];

  if (auto.fresh.length) {
    // A first turbo run can uncover most of the catalogue at once, so name a
    // handful and count the rest rather than printing a wall of labels.
    const names = auto.fresh.map(i => CATALOGUE.find(b => b.index === i).label);
    const shown = names.slice(0, 6);
    const rest = names.length - shown.length;
    $('auto-found').hidden = false;
    $('auto-found').textContent =
      `Found ${names.length} new badge${names.length === 1 ? '' : 's'} this run: ` +
      `${shown.join(', ')}${rest > 0 ? `, and ${rest} more` : ''}.`;
  }
}

function toggleAuto() {
  if (auto.on) { stopAuto(); $('auto-status').textContent = 'Stopped'; }
  else startAuto();
}

// ---------------------------------------------------------------------------
// Catalogue & history views
// ---------------------------------------------------------------------------

let catFilter = 'all';

function renderCatalogue() {
  const q = $('badge-search').value.trim().toLowerCase();
  const rows = CATALOGUE.filter(b => {
    const has = foundBits[b.index] === 1;
    if (catFilter === 'found' && !has) return false;
    if (catFilter === 'missing' && has) return false;
    return !q || b.label.toLowerCase().includes(q) || b.desc.toLowerCase().includes(q) ||
      (b.famName || '').toLowerCase().includes(q);
  });

  const found = foundCount();
  $('progress-fill').style.width = `${(found / BADGE_COUNT) * 100}%`;
  $('progress-label').textContent = `${found} of ${BADGE_COUNT} found`;

  const host = $('catalogue');
  if (!rows.length) {
    host.replaceChildren();
    host.innerHTML = '<p class="empty">No badge matches that.</p>';
    return;
  }

  const frag = document.createDocumentFragment();
  for (const b of rows) {
    const has = foundBits[b.index] === 1;
    const el = document.createElement('div');
    el.className = `row r-${b.rarity}${has ? '' : ' is-locked'}`;
    el.innerHTML = `
      <span class="glyph">${has ? b.emoji : '🔒'}</span>
      <span>
        <span class="name">${b.label}</span>
        <span class="desc">${b.desc}</span>
        ${b.famName ? `<span class="fam">${b.famName} family</span>` : ''}
      </span>
      <span class="num">${fmt(b.ep)} EP<span class="odds">${oddsLabel(b.chance)}</span></span>`;
    frag.append(el);
  }
  host.replaceChildren(frag);
}

function renderHistory() {
  trimTop();
  const host = $('history');
  if (!state.top.length) {
    host.replaceChildren();
    host.innerHTML = '<p class="empty">No rolls yet. Roll something.</p>';
    return;
  }
  const frag = document.createDocumentFragment();
  state.top.forEach((h, i) => {
    const el = document.createElement('div');
    el.className = `row r-${h.rarity}`;
    el.innerHTML = `
      <span>
        <span class="roll">${fmt(h.n)}</span>
        <span class="day">#${i + 1}</span>
      </span>
      <span class="num">${fmt(h.ep)} EP<span class="odds">${h.rarity}</span></span>`;
    frag.append(el);
  });
  host.replaceChildren(frag);
}

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), 2200);
}

async function share() {
  if (!state.best) return;
  const text = shareText(analyze(state.best.n), {
    rolls: state.rolls, found: foundCount(), total: BADGE_COUNT,
  });
  try {
    await navigator.clipboard.writeText(text);
    toast('Best roll copied');
  } catch {
    // Clipboard needs a secure context; fall back to a selectable prompt.
    window.prompt('Copy your result:', text);
  }
}

function switchView(name) {
  for (const tab of document.querySelectorAll('.tab')) {
    const on = tab.dataset.view === name;
    tab.classList.toggle('is-on', on);
    tab.setAttribute('aria-selected', String(on));
  }
  for (const view of document.querySelectorAll('.view')) {
    view.classList.toggle('is-on', view.id === `view-${name}`);
  }
}

function eraseData() {
  if (!confirm('Erase your rolls, EP, and badge collection? This cannot be undone.')) return;
  stopAuto();
  clearTimeout(saveTimer);
  try { localStorage.removeItem(STORE_KEY); } catch { /* already gone */ }
  state = blankState();
  foundBits.fill(0);
  topFloor = 0;
  $('result').hidden = true;
  $('prompt').hidden = false;
  $('share-btn').hidden = true;
  $('auto-live').hidden = true;
  $('auto-found').hidden = true;
  $('stage').className = 'stage';
  renderScoreboard();
  renderCatalogue();
  renderHistory();
  switchView('play');
  toast('Data erased');
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

$('roll-btn').addEventListener('click', rollOnce);
$('auto-btn').addEventListener('click', toggleAuto);
$('share-btn').addEventListener('click', share);
$('reset-btn').addEventListener('click', eraseData);
$('badge-search').addEventListener('input', renderCatalogue);

for (const chip of document.querySelectorAll('.chip')) {
  chip.addEventListener('click', () => {
    catFilter = chip.dataset.filter;
    for (const other of document.querySelectorAll('.chip')) {
      other.classList.toggle('is-on', other === chip);
    }
    renderCatalogue();
  });
}
for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => switchView(tab.dataset.view));
}

// Speed, stop condition and limit are re-read every frame, so changing any of
// them mid-run takes effect immediately without restarting the run.

document.addEventListener('keydown', e => {
  if (e.target.matches('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code === 'Space') { e.preventDefault(); if (!auto.on) rollOnce(); else stopAuto(); }
  if (e.key === 'a' || e.key === 'A') { e.preventDefault(); toggleAuto(); }
});

// A long turbo run holds unsaved progress; don't lose it on navigation.
addEventListener('beforeunload', saveNow);
addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });

renderScoreboard();
renderCatalogue();
renderHistory();

// Open on the player's best roll so the page never starts empty for a returner.
if (state.best) {
  const result = analyze(state.best.n);
  renderResult(result);
  $('oneliner').textContent = `Your best roll so far. ${oneLiner(result)}`;
}
