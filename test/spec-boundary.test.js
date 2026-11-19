// `spec/` holds the framework to its public boundary, so it imports nothing
// from `src/`.
//
// A case talks to a built app over `app.request()`, and the runners reach the
// package by name, `@transclude/core` and its published subpaths, the way an
// installed app does. An import from `src/` would test the code as it is
// written rather than as it is published, and a rewrite of `src/` would break
// the spec for reasons that are not behavior.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const specDir = path.join(root, 'spec');
const srcDir = path.join(root, 'src') + path.sep;

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

test('nothing in spec/ imports from src/', () => {
  const reached = [];
  for (const file of sources(specDir)) {
    for (const specifier of specifiers(fs.readFileSync(file, 'utf8'))) {
      if (!specifier.startsWith('.')) continue;
      const target = path.resolve(path.dirname(file), specifier);
      if (target.startsWith(srcDir)) reached.push(`${path.relative(root, file)} imports ${specifier}`);
    }
  }
  assert.deepEqual(reached, [], `spec/ reaches into src/:\n${reached.join('\n')}`);
});

test('the boundary test sees an import from src/ when there is one', () => {
  // The walk and the pattern are what the test above stands on, so both are
  // shown to find one.
  const file = path.join(specDir, 'runner', 'case.js');
  const target = path.resolve(path.dirname(file), '../../src/app.js');
  assert.ok(target.startsWith(srcDir));
  assert.deepEqual(specifiers(`import { x } from '../../src/app.js';\nawait import('../src/y.js');`), ['../../src/app.js', '../src/y.js']);
});
