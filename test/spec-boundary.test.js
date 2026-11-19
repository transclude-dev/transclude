// `spec/` holds the framework to its public boundary, so it imports nothing
// from `src/`, and it stands on its own, so it imports nothing from `test/`.
//
// A case talks to a built app over `app.request()`, and the runners reach the
// package by name, `@transclude/core` and its published subpaths, the way an
// installed app does. An import from `src/` would test the code as it is
// written rather than as it is published, and a rewrite of `src/` would break
// the spec for reasons that are not behavior. An import from `test/` is how a
// drill found the spec could not run in a copy without the old tests, which is
// the one copy it has to run in.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const specDir = path.join(root, 'spec');
const srcDir = path.join(root, 'src') + path.sep;
const testDir = path.join(root, 'test') + path.sep;

// What the runner builds and writes. Neither is source.
const SKIPPED = new Set(['.build', 'report']);

/** Every `.js` and `.html` file under `spec/`, as an absolute path. */
function sources(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIPPED.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sources(full));
    else if (/\.(js|mjs|html)$/.test(entry.name)) found.push(full);
  }
  return found;
}

/** Each specifier a file imports, static or dynamic. */
function specifiers(source) {
  const pattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

/** Each import in `spec/` that lands under `dir`, as `file imports specifier`. */
function importsInto(dir) {
  const reached = [];
  for (const file of sources(specDir)) {
    for (const specifier of specifiers(fs.readFileSync(file, 'utf8'))) {
      if (!specifier.startsWith('.')) continue;
      const target = path.resolve(path.dirname(file), specifier);
      if (target.startsWith(dir)) reached.push(`${path.relative(root, file)} imports ${specifier}`);
    }
  }
  return reached;
}

test('nothing in spec/ imports from src/', () => {
  const reached = importsInto(srcDir);
  assert.deepEqual(reached, [], `spec/ reaches into src/:\n${reached.join('\n')}`);
});

test('nothing in spec/ imports from test/', () => {
  const reached = importsInto(testDir);
  assert.deepEqual(reached, [], `spec/ reaches into test/:\n${reached.join('\n')}`);
});

test('the boundary test sees an import from src/ when there is one', () => {
  // The walk and the pattern are what the test above stands on, so both are
  // shown to find one.
  const file = path.join(specDir, 'runner', 'case.js');
  const target = path.resolve(path.dirname(file), '../../src/app.js');
  assert.ok(target.startsWith(srcDir));
  assert.deepEqual(specifiers(`import { x } from '../../src/app.js';\nawait import('../src/y.js');`), ['../../src/app.js', '../src/y.js']);
});
