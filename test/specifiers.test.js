// Every import of this project's own packages, checked against what they export.
//
// A documented snippet is code somebody pastes. One of them said
// `transclude/production`, and the package is `@transclude/core`: the same
// mistake the VS Code extension already made from the other side, which
// `test/editor.test.js` was written for. Neither failed anywhere. A wrong
// specifier in prose is not run, and the reader who runs it gets a resolution
// error naming a package they never chose.
//
// So this reads what the repository wrote, the way `test/spelling.test.js`
// does: a repository-wide lint that happens to live in the test suite. It needs
// no app.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

/** The two packages here, each with the subpaths its manifest exports. */
function ours() {
  const table = new Map();
  for (const manifest of ['package.json', 'create/package.json']) {
    const { name, exports, bin } = JSON.parse(read(manifest));
    // A package with no `exports` is reachable only by its bare name, which is
    // what `@transclude/create` is: a `bin`, and nothing to import.
    const subpaths = exports ? Object.keys(exports) : bin ? [] : ['.'];
    table.set(name, new Set(subpaths));
  }
  return table;
}

/**
 * Text this repository wrote, as git lists it. Lockfiles are excluded for the
 * reason `scripts/spelling.js` excludes them: they record what npm resolved,
 * not what anybody wrote.
 */
function files() {
  const listed = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n');
  return listed.filter(
    (rel) =>
      rel &&
      !rel.endsWith('package-lock.json') &&
      /\.(js|mjs|cjs|ts|html|md|json)$/.test(rel) &&
      fs.existsSync(path.join(root, rel)),
  );
}

/**
 * Every specifier in one file that names a package of ours.
 *
 * Only a real import counts: `from '…'`, `import('…')` and `require('…')`.
 * A path written in prose is not one, which is what lets `design/internals.md`
 * go on quoting the wrong name while describing the bug it was.
 */
function importsIn(source) {
  const found = [];
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const [, spec] of source.matchAll(pattern)) {
      if (/^@?transclude(\/|$)/.test(spec)) found.push(spec);
    }
  }
  return found;
}

/** `@transclude/core/app` split into the package and the subpath it asks for. */
function split(spec) {
  const parts = spec.split('/');
  const name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  const rest = spec.slice(name.length);
  return { name, subpath: rest ? `.${rest}` : '.' };
}

test('there is something to read', () => {
  assert.ok(files().length > 100, 'git listed almost nothing');
});

test('every import of our own packages names one that exists', () => {
  const table = ours();
  const wrong = [];

  for (const rel of files()) {
    for (const spec of importsIn(read(rel))) {
      const { name } = split(spec);
      if (!table.has(name)) wrong.push(`${rel}: ${spec}`);
    }
  }

  assert.deepEqual(wrong, [], `these name a package that does not exist:\n${wrong.join('\n')}`);
});

test('every import of our own packages asks for a subpath they export', () => {
  const table = ours();
  const wrong = [];

  for (const rel of files()) {
    for (const spec of importsIn(read(rel))) {
      const { name, subpath } = split(spec);
      const exported = table.get(name);
      if (exported && !exported.has(subpath)) wrong.push(`${rel}: ${spec}`);
    }
  }

  assert.deepEqual(wrong, [], `these ask for a subpath nothing exports:\n${wrong.join('\n')}`);
});
