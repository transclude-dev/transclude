// The publish surface: what `exports` promises and what `files` actually ships.
//
// Declarations are generated, never committed. `dist/` is ignored here, so the
// `.d.ts` files exist on a machine that has run `npm run types` and nowhere
// else, and `prepack` is what puts them in the tarball. That makes the mapping
// the thing worth pinning: a subpath added to `exports` with no `types`
// condition ships a module TypeScript reads as `any`, and nothing fails.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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

test('each types condition names the declaration its source will emit', () => {
  // `tsconfig.types.json` maps `src/x.js` to `dist/types/x.d.ts`. Checked as a
  // path rather than as a file, because the file exists only after an emit.
  for (const [subpath, target] of targets()) {
    if (!target.startsWith('./src/')) continue;

    const expected = `./dist/types/${target.slice('./src/'.length).replace(/\.js$/, '.d.ts')}`;
    assert.equal(manifest.exports[subpath].types, expected, `${subpath} names the wrong declaration`);
  }
});

test('the publish list ships the declarations it points at', () => {
  assert.ok(manifest.files.includes('dist/types'), 'dist/types is not published');
});

test('a pack regenerates the declarations first', () => {
  // Without this the tarball carries whatever the last local emit left, or
  // nothing at all, and every types condition points at a file that is not there.
  assert.match(manifest.scripts.prepack ?? '', /\btypes\b/);
});
