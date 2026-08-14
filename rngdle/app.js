// RNGdle UI: owns the daily lock, local stats, and the reveal.
// All game rules live in engine.js — nothing here decides what a roll is worth.

import {
  analyze, roll, CATALOGUE, shareText,
  dayKey, msUntilReset, isNextDay, ROLL_MAX,
} from './engine.js';

const STORE_KEY = 'rngdle.v1';
const $ = id => document.getElementById(id);
const fmt = n => n.toLocaleString('en-US');

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const blankState = () => ({
  lastDay: null,   // UTC day of the most recent scored roll
  lastRoll: null,  // the number itself, so a refresh re-shows it
  streak: 0,
  rolls: 0,
  lifetimeEP: 0,
  best: null,      // { n, ep, day }
  history: [],     // newest first, capped
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

function save(state) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch { /* nothing we can do; the session still plays */ }
}

let state = load();

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderScoreboard() {
  $('stat-streak').textContent = state.streak;
  $('stat-rolls').textContent = state.rolls;
  $('stat-lifetime').textContent = fmt(state.lifetimeEP);
  $('stat-best').textContent = state.best ? fmt(state.best.n) : '—';
}

function badgeCard(b, i) {
  const el = document.createElement('div');
  el.className = `badge r-${b.rarity}${b.scored ? '' : ' is-muted'}`;
  el.style.animationDelay = `${Math.min(i, 24) * 26}ms`;
  el.innerHTML = `
    <span class="glyph">${b.emoji}</span>
    <span class="body">
      <span class="name">${b.label}</span>
      <span class="meta">${b.scored ? `+${fmt(b.ep)} EP` : ''}</span>
      ${b.scored ? '' : `<span class="superseded">covered by your ${b.famName} badge</span>`}
    </span>`;
  el.title = `${b.desc}  ·  ${b.rarity}  ·  ${oddsLabel(b.chance)}`;
  return el;
}

/** "1 in 14,493" reads better than a probability for anything this rare. */
function oddsLabel(chance) {
  if (chance >= 0.1) return `${(chance * 100).toFixed(1)}% of rolls`;
  return `1 in ${fmt(Math.round(1 / chance))}`;
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

function renderResult(result, { practice = false } = {}) {
  $('prompt').hidden = true;
  $('result').hidden = false;
  $('practice-note').hidden = !practice;

  $('number').textContent = fmt(result.n);
  $('number').classList.remove('is-rolling');

  const pill = $('rarity');
  pill.textContent = result.rarity;
  pill.className = `pill r-${result.rarity}`;

  $('ep').textContent = fmt(result.totalEP);
  $('oneliner').textContent = oneLiner(result);

  const list = $('badge-list');
  list.replaceChildren(...result.badges.map(badgeCard));

  $('share-btn').hidden = practice;
}

/** Spin through decoys before landing, so the reveal has a beat to it. */
function revealNumber(final, done) {
  const el = $('number');
  const slow = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (slow) { done(); return; }

  el.classList.add('is-rolling');
  const start = performance.now();
  const DURATION = 900;

  (function tick(now) {
    const t = (now - start) / DURATION;
    if (t >= 1) { done(); return; }
    el.textContent = fmt(Math.floor(Math.random() * (ROLL_MAX + 1)));
    // Ease out: frames get further apart as it settles.
    setTimeout(() => requestAnimationFrame(tick), 30 + t * t * 150);
  })(start);
}

// ---------------------------------------------------------------------------
// Rolling
// ---------------------------------------------------------------------------

function alreadyRolledToday() {
  return state.lastDay === dayKey() && state.lastRoll !== null;
}

function doDailyRoll() {
  if (alreadyRolledToday()) return;
  const n = roll();
  const result = analyze(n);
  const today = dayKey();

  state.streak = isNextDay(state.lastDay, today) ? state.streak + 1 : 1;
  state.lastDay = today;
  state.lastRoll = n;
  state.rolls += 1;
  state.lifetimeEP += result.totalEP;
  if (!state.best || result.totalEP > state.best.ep) {
    state.best = { n, ep: result.totalEP, day: today };
  }
  state.history.unshift({ day: today, n, ep: result.totalEP, rarity: result.rarity });
  state.history = state.history.slice(0, 60);
  save(state);

  $('roll-btn').disabled = true;
  revealNumber(n, () => {
    renderResult(result);
    renderScoreboard();
    renderHistory();
  });
}

function doPracticeRoll() {
  const result = analyze(roll());
  revealNumber(result.n, () => renderResult(result, { practice: true }));
}

// ---------------------------------------------------------------------------
// Countdown
// ---------------------------------------------------------------------------

function tickCountdown() {
  const ms = msUntilReset();
  const s = Math.floor(ms / 1000);
  const pad = v => String(v).padStart(2, '0');
  $('countdown').textContent =
    `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;

  // Crossing midnight mid-session should free up tomorrow's roll.
  if (ms <= 1000 && alreadyRolledToday() === false) location.reload();
}

// ---------------------------------------------------------------------------
// Catalogue & history views
// ---------------------------------------------------------------------------

function renderCatalogue(filter = '') {
  const q = filter.trim().toLowerCase();
  const rows = CATALOGUE.filter(b =>
    !q || b.label.toLowerCase().includes(q) || b.desc.toLowerCase().includes(q) ||
    (b.famName || '').toLowerCase().includes(q));

  const frag = document.createDocumentFragment();
  for (const b of rows) {
    const el = document.createElement('div');
    el.className = `row r-${b.rarity}`;
    el.innerHTML = `
      <span class="glyph">${b.emoji}</span>
      <span>
        <span class="name">${b.label}</span>
        <span class="desc">${b.desc}</span>
        ${b.famName ? `<span class="fam">${b.famName} family</span>` : ''}
      </span>
      <span class="num">${fmt(b.ep)} EP<span class="odds">${oddsLabel(b.chance)}</span></span>`;
    frag.append(el);
  }
  const host = $('catalogue');
  host.replaceChildren(frag);
  if (!rows.length) {
    host.innerHTML = '<p class="empty">No badge matches that.</p>';
  }
}

function renderHistory() {
  const host = $('history');
  if (!state.history.length) {
    host.innerHTML = '<p class="empty">No rolls yet. Come back after your first one.</p>';
    return;
  }
  const frag = document.createDocumentFragment();
  for (const h of state.history) {
    const el = document.createElement('div');
    el.className = `row r-${h.rarity}`;
    el.innerHTML = `
      <span>
        <span class="roll">${fmt(h.n)}</span>
        <span class="day">${h.day}</span>
      </span>
      <span class="num">${fmt(h.ep)} EP<span class="odds">${h.rarity}</span></span>`;
    frag.append(el);
  }
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
  toastTimer = setTimeout(() => el.classList.remove('is-on'), 1900);
}

async function share() {
  if (state.lastRoll === null) return;
  const text = shareText(analyze(state.lastRoll), state.lastDay, state.streak);
  try {
    await navigator.clipboard.writeText(text);
    toast('Result copied');
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
  if (!confirm('Erase your streak, EP, and roll history? This cannot be undone.')) return;
  try { localStorage.removeItem(STORE_KEY); } catch { /* already gone */ }
  state = blankState();
  $('result').hidden = true;
  $('prompt').hidden = false;
  $('roll-btn').disabled = false;
  renderScoreboard();
  renderHistory();
  switchView('play');
  toast('Data erased');
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

// A streak only survives if yesterday was played. Catch up lapsed streaks on load
// so the scoreboard is honest before the player rolls again.
if (state.lastDay && state.lastDay !== dayKey() && !isNextDay(state.lastDay, dayKey())) {
  state.streak = 0;
  save(state);
}

$('roll-btn').addEventListener('click', doDailyRoll);
$('practice-btn').addEventListener('click', doPracticeRoll);
$('share-btn').addEventListener('click', share);
$('reset-btn').addEventListener('click', eraseData);
$('badge-search').addEventListener('input', e => renderCatalogue(e.target.value));
for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => switchView(tab.dataset.view));
}

renderScoreboard();
renderCatalogue();
renderHistory();

if (alreadyRolledToday()) {
  renderResult(analyze(state.lastRoll));
  $('roll-btn').disabled = true;
}

tickCountdown();
setInterval(tickCountdown, 1000);
