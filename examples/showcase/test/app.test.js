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

test('the worker entry uses the shared app rather than its own', () => {
  const source = sourceOf('worker.js');
  assert.match(source, /createApp\(/);
  // Anything reimplemented here is something four runtimes keep in sync by hand.
  for (const leaked of ['renderRoute', 'runAction', 'baseApp', 'ACTION_METHODS']) {
    assert.doesNotMatch(source, new RegExp(leaked), `it reimplements ${leaked}`);
  }
});

test('the worker entry builds the app per request, not at import', () => {
  // `env` arrives with the request. A secret read at import time is undefined, and
  // signing then refuses while the variable is set. That is what happened.
  const source = sourceOf('worker.js');
  assert.match(source, /fetch:\s*\(request, env/, 'it never sees env');
  assert.match(source, /env\.COOKIE_SECRET/, 'it does not read config from env');
});

test('the worker entry reaches the framework by name, not by path', () => {
  // The whole point of the package boundary. A relative import here would work
  // in this repo and nowhere else.
  const source = sourceOf('worker.js');
  assert.match(source, /from '@transclude\/core\/app'/);
  assert.match(source, /from '@transclude\/core\/worker'/);
  assert.doesNotMatch(source, /from '\.\.?\/framework/, 'it reaches into the package directory');
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
