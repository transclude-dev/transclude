// The publish surface: what `exports` promises and what `files` actually ships.
//
// `types/api` is generated and committed, which nothing else generated here is.
// `publish.yml` stages the tarball with `--ignore-scripts` and no `npm ci`, so
// no build runs at publish time by design: that job holds the only identity
// that can release. A `prepack` would have run nowhere, and every `types`
// condition would have named a file no tarball carried — types that resolve to
// nothing, which is worse for a reader than no types at all, because the
// missing file is an error rather than a fallback.
//
// So both halves are pinned here: the mapping, because a subpath added with no
// `types` condition reads as `any` and fails nowhere, and the output, because a
// committed generated file drifts from its source the first time somebody edits
// one and not the other.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

/** `[subpath, target]` for every export, whichever form it is written in. */
function targets() {
  return Object.entries(manifest.exports).map(([subpath, entry]) => [
    subpath,
    typeof entry === 'string' ? entry : entry.default,
  ]);
}

/**
 * The public API, written down.
 *
 * Every name here is a promise: an app that imports one and a version that
 * removes or renames it is a major. Adding to this list is a minor and costs
 * nothing; the point is that neither happens by accident, in a manifest edit
 * nobody read as an API change.
 *
 * The docs say the config keys and the loader context are settled and pinned to
 * the code. This is the third table that claim covers, and it was the one
 * nothing pinned.
 */
const PUBLIC = [
  '.',
  './app',
  './compiler',
  './cookies',
  './document',
  './production',
  './routes',
  './runtime',
  './serve.bun',
  './serve.deno',
  './typecheck',
  './worker',
];

test('the public API is exactly what it was', () => {
  const now = Object.keys(manifest.exports).sort();
  const then = [...PUBLIC].sort();

  const added = now.filter((one) => !then.includes(one));
  const gone = then.filter((one) => !now.includes(one));

  assert.deepEqual(
    gone,
    [],
    `these subpaths are gone, which is a major:\n  ${gone.join('\n  ')}`,
  );
  assert.deepEqual(
    added,
    [],
    `these subpaths are new. Add them to PUBLIC, and ship a minor:\n  ${added.join('\n  ')}`,
  );
});

/**
 * The names behind each promised subpath.
 *
 * A subpath is a path, and a path that resolves says nothing about what is
 * behind it. `PUBLIC` pins the paths. This pins what an app may import from
 * one, because those are two promises and only the first was being kept: ten of
 * the twelve subpaths export eighty names between them, and most exist so the
 * framework can talk to itself.
 *
 * Every name here is covered by `VERSIONING.md` and does not move without a
 * major. Adding one is a minor and costs nothing. A subpath absent from this
 * table is in `WIRING` below.
 */
const PROMISED = {
  '.': ['default'],
  './app': ['createApp'],
  './cookies': ['cookiesOf'],
  './document': ['renderFragment', 'renderRoute', 'responseOf'],
  './production': ['app', 'noBuild', 'port', 'summary'],
  './worker': ['workerFrom'],
};

/**
 * Subpaths whose names are the framework's own wiring.
 *
 * The path stays — removing one is still a major — and the names behind it
 * move between minors. `./runtime` is the clearest case: those names are what
 * the compiler emits calls to, so they are an output format rather than an API,
 * and an app that imports one has reached past the seam.
 */
const WIRING = ['./compiler', './routes', './runtime', './serve.bun', './serve.deno', './typecheck'];

/**
 * What a module exports, read rather than imported.
 *
 * `./production` loads the app's config the moment it is imported and throws
 * where there is no app, and `src/plugin.js` writes `export const pages` inside
 * a template literal, which a search for the word would count. A parse answers
 * both: it runs nothing and it knows generated text from code.
 *
 * @param {string} target the `./src/…` path an export condition names
 * @returns {string[]} every name the module exports, `default` included
 */
function exportsOf(target) {
  const source = fs.readFileSync(path.join(root, target), 'utf8');
  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });

  const names = [];
  for (const node of ast.body) {
    if (node.type === 'ExportDefaultDeclaration') names.push('default');
    if (node.type !== 'ExportNamedDeclaration') continue;

    for (const spec of node.specifiers) names.push(spec.exported.name);
    const declared = node.declaration;
    if (!declared) continue;
    if (declared.id) names.push(declared.id.name);
    for (const one of declared.declarations ?? []) names.push(one.id.name);
  }
  return names;
}

test('every subpath is either promised or wiring', () => {
  // A subpath added to `exports` and to neither table is a promise nobody
  // decided to make. The decision is which of the two it is, and this is where
  // it gets asked.
  const filed = new Set([...Object.keys(PROMISED), ...WIRING]);
  const unfiled = Object.keys(manifest.exports).filter((subpath) => !filed.has(subpath));

  assert.deepEqual(
    unfiled,
    [],
    `these subpaths are in neither PROMISED nor WIRING:\n  ${unfiled.join('\n  ')}`,
  );
});

test('every promised name is still exported', () => {
  // The promise `VERSIONING.md` makes, kept here. A name that goes missing is a
  // major, and this is what makes that a decision rather than a discovery
  // somebody makes after upgrading.
  for (const [subpath, names] of Object.entries(PROMISED)) {
    const target = manifest.exports[subpath];
    const file = typeof target === 'string' ? target : target.default;
    const found = exportsOf(file);

    const gone = names.filter((name) => !found.includes(name));
    assert.deepEqual(gone, [], `${subpath} no longer exports ${gone.join(', ')}, which is a major`);
  }
});

test('the policy names both tables', () => {
  // `VERSIONING.md` is where the promise is written down and this file is where
  // it is kept. A policy that stopped mentioning the names would leave the
  // tables above pinning something nothing claims.
  const policy = fs.readFileSync(path.join(root, 'VERSIONING.md'), 'utf8');
  assert.match(policy, /PROMISED/, 'the policy does not name the promised table');
  assert.match(policy, /WIRING/, 'the policy does not name the wiring table');
});

test('every exported subpath points at a file that is here', () => {
  for (const [subpath, target] of targets()) {
    assert.ok(target, `${subpath} has no default condition`);
    assert.ok(fs.existsSync(path.join(root, target)), `${subpath} points at ${target}, which is gone`);
  }
});

test('every module people import carries a types condition', () => {
  // The two `serve.*` entries are run by a runtime, not imported by anybody, so
  // a declaration for either would describe a module with no callers.
  for (const [subpath, target] of targets()) {
    if (!target.startsWith('./src/')) continue;

    const entry = manifest.exports[subpath];
    assert.equal(typeof entry, 'object', `${subpath} is a bare string, so it ships no types`);
    assert.ok(entry.types, `${subpath} has no types condition`);
  }
});

test('types is declared before default', () => {
  // Conditions resolve in order. A `default` written first answers every
  // lookup, TypeScript's included, and the types condition below it is dead.
  for (const [subpath, entry] of Object.entries(manifest.exports)) {
    if (typeof entry === 'string') continue;
    assert.equal(Object.keys(entry)[0], 'types', `${subpath} lists default above types`);
  }
});

test('each types condition names the declaration its source emits', () => {
  // `tsconfig.types.json` maps `src/x.js` to `types/api/x.d.ts`.
  for (const [subpath, target] of targets()) {
    if (!target.startsWith('./src/')) continue;

    const expected = `./types/api/${target.slice('./src/'.length).replace(/\.js$/, '.d.ts')}`;
    assert.equal(manifest.exports[subpath].types, expected, `${subpath} names the wrong declaration`);
  }
});

test('every types condition points at a file that is here', () => {
  // The half `prepack` used to be responsible for, and could not be: this is
  // what a tarball made with `--ignore-scripts` carries.
  for (const [subpath, entry] of Object.entries(manifest.exports)) {
    if (typeof entry === 'string') continue;
    assert.ok(
      fs.existsSync(path.join(root, entry.types)),
      `${subpath} points at ${entry.types}, which nothing emitted`,
    );
  }
});

test('the versioning policy names tests that exist', () => {
  // `VERSIONING.md` says which test pins each promise. A table naming a test
  // that was renamed or deleted is a policy claiming a guarantee nothing keeps,
  // which is worse than not claiming it.
  const policy = fs.readFileSync(path.join(root, 'VERSIONING.md'), 'utf8');
  const named = [...policy.matchAll(/`(test\/[\w.-]+\.test\.js)`/g)].map((m) => m[1]);

  assert.ok(named.length >= 3, 'the policy names no tests, so the table went missing');
  for (const rel of named) {
    assert.ok(fs.existsSync(path.join(root, rel)), `VERSIONING.md names ${rel}, which is gone`);
  }
});

test('the publish list ships the declarations it points at', () => {
  assert.ok(manifest.files.includes('types/api'), 'types/api is not published');
});

test('the committed declarations are what the source emits', () => {
  // Committed generated files drift, and this pair drifts silently: the stale
  // declaration still resolves, still type checks, and describes a function
  // signature that changed. Regenerated into a temporary directory and compared,
  // which is slower than reading a hash and is the only way to be sure.
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'transclude-types-'));
  try {
    execFileSync(
      'npx',
      ['tsc', '-p', 'tsconfig.types.json', '--outDir', out],
      { cwd: root, stdio: 'pipe' },
    );
  } catch (err) {
    assert.fail(`the emit failed: ${err.stdout ?? err.message}`);
  }

  const listing = (dir) => {
    const found = [];
    const walk = (at, prefix) => {
      for (const entry of fs.readdirSync(at, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(path.join(at, entry.name), rel);
        else found.push(rel);
      }
    };
    walk(dir, '');
    return found;
  };

  const committed = path.join(root, 'types/api');
  assert.deepEqual(listing(out), listing(committed), 'the emit and `types/api` hold different files');

  const stale = listing(out).filter(
    (rel) => fs.readFileSync(path.join(out, rel), 'utf8') !== fs.readFileSync(path.join(committed, rel), 'utf8'),
  );
  fs.rmSync(out, { recursive: true, force: true });

  assert.deepEqual(stale, [], `these are behind their source; run \`npm run types\`:\n${stale.join('\n')}`);
});
