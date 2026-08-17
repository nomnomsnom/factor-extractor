/* Tests for the browser engine's pure logic.
 *
 *   node --test agent_graph/ui/engine.test.mjs
 *
 * engine.js is a plain script that hangs itself off `window`, so the shim below
 * is all it needs to load outside a browser. Only the parts that touch neither
 * the DOM nor the network are exercised here — the request path is covered by
 * the Python-side request-shaping tests and by hitting the API directly.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const context = { console, setTimeout, fetch: () => { throw new Error('no network'); } };
context.window = context;
vm.createContext(context);
vm.runInContext(readFileSync(join(here, 'engine.js'), 'utf8'), context);

const { calculate } = context.window.AgentGraphEngine;

test('evaluates arithmetic', () => {
  assert.equal(calculate('2+2'), '4');
  assert.equal(calculate('2 * (3 + 4)'), '14');
  assert.equal(calculate('100 / 8'), '12.5');
  assert.equal(calculate('10 % 3'), '1');
  assert.equal(calculate('(1250 * 0.07) / 12').slice(0, 6), '7.2916');
});

test('follows the usual precedence and associativity', () => {
  assert.equal(calculate('2 + 3 * 4'), '14');
  assert.equal(calculate('2 ** 3 ** 2'), '512');   // right-associative
  assert.equal(calculate('10 - 4 - 3'), '3');      // left-associative
});

test('handles unary minus', () => {
  assert.equal(calculate('-5 + 3'), '-2');
  assert.equal(calculate('1 - -2'), '3');          // regressed once: gave -1
  assert.equal(calculate('2 * -3'), '-6');
  assert.equal(calculate('-(4)'), '-4');
  assert.equal(calculate('--3'), '3');
  assert.equal(calculate('-2 ** 2'), '-4');        // binds looser than **
});

test('rejects anything that is not arithmetic', () => {
  for (const hostile of [
    "__import__('os')", 'alert(1)', "fetch('/x')", 'a + b', '1;2',
    'globalThis', '[].constructor', '1..toString',
  ]) {
    assert.throws(() => calculate(hostile), /numeric arithmetic|unexpected token/,
                  `should reject ${hostile}`);
  }
});

test('rejects malformed input', () => {
  assert.throws(() => calculate('(1+2'), /unbalanced/);
  assert.throws(() => calculate('1+)'), /unbalanced/);
  assert.throws(() => calculate(''), /malformed/);
  assert.throws(() => calculate('1 +'), /malformed/);
  assert.throws(() => calculate('2**9999'), /exponent out of range/);
  assert.throws(() => calculate('x'.repeat(600)), /too long/);
});

test('rejects a division that is not finite', () => {
  assert.throws(() => calculate('1/0'), /malformed/);
});
