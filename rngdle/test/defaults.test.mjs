// The engine can be perfect while the page ships a default that makes the game
// behave wrongly. That is exactly what happened once: the auto-roll stop
// condition defaulted to "New badge", and since a fresh collection makes every
// badge new, the first roll always satisfied it — so auto-roll ended after one
// roll and was indistinguishable from rolling by hand.
//
// These read the real index.html rather than a copy, so the defaults a player
// actually gets are what is under test.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

/** Pull one <select> and its options out of the page. */
function select(id) {
  const block = html.match(new RegExp(`<select id="${id}">([\\s\\S]*?)</select>`));
  assert.ok(block, `no <select id="${id}"> in index.html`);
  const options = [...block[1].matchAll(/<option value="([^"]*)"([^>]*)>([^<]*)</g)]
    .map(([, value, attrs, label]) => ({ value, label, selected: /\bselected\b/.test(attrs) }));
  return { options, chosen: options.filter(o => o.selected) };
}

const SELECTS = ['speed-select', 'stop-select', 'limit-select'];

test('every auto-roll control has exactly one default', () => {
  for (const id of SELECTS) {
    const { chosen } = select(id);
    assert.equal(chosen.length, 1, `${id} should have exactly one selected option`);
  }
});

test('auto-roll actually auto-rolls on a fresh profile', () => {
  // With nothing collected, "new" fires on roll one. Anything else lets a run
  // build up. This is the specific regression that shipped.
  const stop = select('stop-select').chosen[0];
  assert.notEqual(stop.value, 'new',
    'defaulting to "New badge" ends every run on the first roll while the collection is empty');

  // A rarity default would also stall: rarity stops are rare by construction,
  // so only "never" guarantees a visible run out of the box.
  assert.equal(stop.value, 'none', 'the default stop condition should be "Never"');
});

test('the default roll limit gives a run worth watching, and terminates', () => {
  const limit = Number(select('limit-select').chosen[0].value);
  assert.ok(limit > 1, 'a default limit of 0 or 1 would defeat auto-roll');
  assert.ok(limit <= 100000, 'the default run should finish quickly, not grind');
});

test('the default speed is a real speed', () => {
  const speed = select('speed-select').chosen[0].value;
  assert.ok(['slow', 'fast', 'turbo'].includes(speed), `unknown default speed ${speed}`);
});

test('every stop option the page offers is one the app understands', () => {
  // app.js treats "none" and "new" specially and looks everything else up in
  // RARITY_ORDER; a typo'd tier would silently never fire.
  const RARITY_ORDER = ['Common', 'Uncommon', 'Rare', 'Epic', 'Anomaly', 'Mythic'];
  for (const { value } of select('stop-select').options) {
    assert.ok(value === 'none' || value === 'new' || RARITY_ORDER.includes(value),
      `stop option "${value}" is neither a mode nor a known rarity`);
  }
});

test('the Roll button comes before the badge grid', () => {
  // A good roll earns a dozen-plus badges. With the grid above the controls you
  // have to scroll past your own result to roll again, which is backwards.
  const roll = html.indexOf('id="roll-btn"');
  const grid = html.indexOf('id="badge-list"');
  assert.ok(roll > 0 && grid > 0, 'expected both the roll button and the badge grid');
  assert.ok(roll < grid, 'the roll button should sit above the badges, not below them');
});

test('the badge grid collapses while empty', () => {
  // It sits outside #result now, so `hidden` on the result no longer covers it;
  // without this rule the stage shows a divider above nothing on a first visit.
  const css = readFileSync(join(ROOT, 'styles.css'), 'utf8');
  assert.match(html, /id="badge-list"[^>]*>\s*<\/div>/,
    'the grid must ship with no whitespace inside it for :empty to match');
  assert.match(css, /\.stage-badges:empty\s*\{[^}]*display:\s*none/);
});

test('a reset control is reachable from the play screen', () => {
  const controls = html.match(/<div class="controls">([\s\S]*?)<\/div>/);
  assert.ok(controls, 'no controls row in index.html');
  assert.match(controls[1], /data-reset/,
    'the play screen should offer a reset without digging through tabs');

  // app.js binds every [data-reset]; an id-based binding would miss the second.
  const app = readFileSync(join(ROOT, 'app.js'), 'utf8');
  assert.match(app, /querySelectorAll\('\[data-reset\]'\)/);
  assert.ok(html.match(/data-reset/g).length >= 2, 'expected the Best-tab reset too');
});

test('every id app.js reaches for exists in the page', () => {
  // A renamed element would throw on the first frame of a run.
  const app = readFileSync(join(ROOT, 'app.js'), 'utf8');
  const ids = new Set([...app.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]));
  assert.ok(ids.size > 10, 'expected to find the app\'s element lookups');
  for (const id of ids) {
    assert.ok(html.includes(`id="${id}"`), `app.js reads #${id}, which index.html does not define`);
  }
});
