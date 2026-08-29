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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

/** `[subpath, target]` for every export, whichever form it is written in. */
function targets() {
  return Object.entries(manifest.exports).map(([subpath, entry]) => [
    subpath,
    typeof entry === 'string' ? entry : entry.default,
  ]);
}

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
