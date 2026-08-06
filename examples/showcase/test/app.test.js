// The app's own tests, about the files the app owns.
//
// `framework/test` covers the framework. These cover the two files that wire a
// runtime to it here: `worker.js` and `transclude.config.js`. They used to live
// in `framework/test/portable.test.js`, which meant the framework's suite failed
// when the demo changed.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Source with comments removed, so a guard cannot pass on the text explaining it. */
const codeOf = (file) =>
  fs
    .readFileSync(path.join(root, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

const sourceOf = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// ---- the worker entry ------------------------------------------------------
//
// The one that proves the split was worth making: no filesystem, no node:crypto,
// no zlib, and `app.js` unchanged. Verified against workerd with `wrangler dev`.

test('the worker entry imports nothing from node:', () => {
  assert.doesNotMatch(sourceOf('worker.js'), /from 'node:/, 'this file must not need Node');
  assert.doesNotMatch(codeOf('worker.js'), /\b(Buffer|process|__dirname|require)\b/);
});

test('the worker entry uses the shared wiring rather than its own', () => {
  // This file used to hold the forty lines `workerFrom` now holds, and the
  // assertions about them moved to `test/worker.test.js` in the package. What is
  // left here is the part only an app can get wrong.
  const source = sourceOf('worker.js');
  assert.match(source, /workerFrom\(\{/);
  // Anything reimplemented here is something four runtimes keep in sync by hand.
  for (const leaked of ['renderRoute', 'runAction', 'baseApp', 'ACTION_METHODS', 'createApp']) {
    assert.doesNotMatch(source, new RegExp(leaked), `it reimplements ${leaked}`);
  }
});

test('the worker entry hands over everything the wiring needs', () => {
  // Each of these names something only this app knows the path to, because a
  // bundler needs a literal specifier and cannot follow one built at runtime.
  const source = sourceOf('worker.js');
  for (const part of ['config', 'manifest', 'entry', 'bundle']) {
    assert.match(source, new RegExp(`\\b${part}\\b`), `it never passes ${part}`);
  }
  assert.match(source, /from '\.\/dist\/server\/entry\.js'/);
  assert.match(source, /from '\.\/dist\/routes\.json'/);
});

test('the worker entry reaches the framework by name, not by path', () => {
  // The whole point of the package boundary. A relative import here would work
  // in this repo and nowhere else.
  const source = sourceOf('worker.js');
  assert.match(source, /from '@transclude\/core\/worker'/);
  assert.doesNotMatch(source, /from '\.\.?\/framework/, 'it reaches into the package directory');
  assert.doesNotMatch(source, /from '\.\.\/\.\.\/src/, 'it reaches into the package source');
});

test('wrangler points at the app entry', () => {
  assert.match(sourceOf('wrangler.jsonc'), /"main":\s*"worker\.js"/);
});

// ---- the config ------------------------------------------------------------

test('the config never touches `process` at import', () => {
  // The worker build imports this module, and a runtime with no Node
  // compatibility has no `process`, and a bare reference throws before anything runs.
  const code = codeOf('transclude.config.js');

  assert.doesNotMatch(code, /(?<!globalThis\.)\bprocess\.env/);
  assert.match(code, /globalThis\.process\?\.env/);
});
