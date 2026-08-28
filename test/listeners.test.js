// A listener on something that outlives the element it was added from.

import test from 'node:test';
import assert from 'node:assert/strict';

import { compileComponent } from '../src/compiler/index.js';

// The code goes in `connected`, which is where a listener is registered now.
const warnings = (script) =>
  compileComponent(
    `<p>x</p><script element>export const prototype = { connected({ signal }) { void signal; ${script} } };</script>`,
    { tag: 'a-a', runtime: 'x' },
  ).warnings;

test('a listener on document with no signal is reported', () => {
  // The element goes and the listener stays, holding its closure. Every element
  // after it adds another, and nothing anywhere says so.
  const [first] = warnings('document.addEventListener("keydown", f);');

  assert.match(first, /document\.addEventListener\("keydown"\) has no `signal`/);
  assert.match(first, /line 1/);
});

test('window, globalThis and the other long-lived ones count too', () => {
  for (const target of ['window', 'globalThis', 'screen', 'navigator', 'visualViewport']) {
    assert.equal(warnings(`${target}.addEventListener("x", f);`).length, 1, target);
  }
});

test('passing a signal says nothing', () => {
  assert.deepEqual(warnings('document.addEventListener("keydown", f, { signal });'), []);
  assert.deepEqual(warnings('document.addEventListener("keydown", f, { once: true, signal });'), []);
  assert.deepEqual(warnings('document.addEventListener("keydown", f, { ...opts });'), []);
});

test('a boolean third argument is capture, and carries no signal', () => {
  // The old spelling. It looks like an options argument and is not one.
  assert.equal(warnings('window.addEventListener("resize", f, true);').length, 1);
  assert.equal(warnings('window.addEventListener("resize", f, false);').length, 1);
});

test('an options variable is left alone, because it may hold one', () => {
  // Only the shapes this can read are reported. Guessing at a variable would
  // make the warning something to switch off.
  assert.deepEqual(warnings('document.addEventListener("keydown", f, opts);'), []);
});

test('a listener on the element itself is not reported', () => {
  // It is collected with the element, so it needs nothing.
  assert.deepEqual(warnings('host.addEventListener("click", f);'), []);
  assert.deepEqual(warnings('shadow.addEventListener("click", f);'), []);
});

test('the same call is reported once, not once per mention', () => {
  const found = warnings(
    'document.addEventListener("keydown", f);\ndocument.addEventListener("keyup", g);',
  );
  assert.equal(found.length, 2);
});

test('a listener nested in a function is still found', () => {
  assert.equal(warnings('function on() { document.addEventListener("x", f); } on();').length, 1);
});

// ---- who ships the swap watcher --------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('the swap watcher is off unless a config asks for it', () => {
  // It puts a script on every page. It used to follow `fragmentParam`, so any
  // app that could serve a fragment paid for it whether or not swaps ever
  // brought in an element. One rule decides who ships a client entry, and
  // nothing else reads this, so the source is where it can be checked.
  const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/plugin.js');
  const source = fs
    .readFileSync(src, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  assert.match(source, /watchElements = false/, 'the default is not off');
  assert.match(source, /watchElements === true/, 'a truthy value would turn it on');
  assert.doesNotMatch(source, /Boolean\(fragmentParam\)/, 'it follows fragmentParam again');
});
