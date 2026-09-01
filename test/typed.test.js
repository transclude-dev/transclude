// A ratchet on `npm run check:src`, which is red and was in nothing.
//
// The framework type checks its own source through JSDoc, and 476 errors had
// accumulated because the script existed and no job ran it. Nearly all of them
// are one shape: a parameter documented `@param {object}`, which says "opaque"
// rather than a shape, so every read of a field on it is an error.
//
// Fixing them is a long job. This stops the bleeding: every file has a ceiling,
// and a change that makes one worse fails here rather than in a review nobody
// ran. Lowering a ceiling is the work, and a file that improves is reported
// rather than failed: a ceiling above where a file sits is safe, and failing on
// one would hand a chore to whoever improved it.
//
// The job is being done in slices. Writing down `Config`, `Manifest`, `Route`,
// `Entry` and the Hono app took it from 403 to 306, and cleared the path a
// deploy runs through end to end. What is left sits mostly in two files:
// `src/runtime/index.js`, whose values are DOM nodes and the data a compiled
// page hands it, and `src/compiler/index.js`, whose values are parse5 nodes.
// Both want a shape written for the thing itself rather than a wider annotation
// on each function that touches it.
//
// tsc costs a quarter of a second on this tree, which is why this can be a test
// rather than a job somebody remembers.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Errors per file, as tsc reports them.
 *
 * Only a line that opens with `path(line,col): error TS` counts. A message can
 * run to several lines, and the continuations are indented prose that would
 * otherwise be read as filenames.
 */
function errors() {
  let output = '';
  try {
    execFileSync('npx', ['tsc', '-p', 'tsconfig.src.json'], { cwd: root, encoding: 'utf8' });
  } catch (err) {
    output = String(err.stdout ?? '');
  }

  const counted = new Map();
  for (const line of output.split('\n')) {
    const file = line.match(/^([^(\s][^(]*)\(\d+,\d+\): error TS\d+:/)?.[1];
    if (file) counted.set(file, (counted.get(file) ?? 0) + 1);
  }
  return counted;
}

/**
 * What each file is allowed. Written down rather than computed, because a
 * ceiling that measures itself is not a ceiling.
 *
 * Lower one whenever you make a file better. Nothing here may go up.
 */
const CEILING = {
  'bin/build.js': 2,
  'bin/check.js': 1,
  'bin/dev.js': 6,
  'src/after.js': 1,
  'src/app.js': 5,
  'src/cache.js': 7,
  'src/compiler/bind.js': 2,
  'src/compiler/codegen.js': 9,
  'src/compiler/index.js': 79,
  'src/compiler/script.js': 4,
  'src/compiler/shim.js': 13,
  'src/compiler/types.js': 16,
  'src/csp.js': 4,
  'src/defaults.js': 1,
  'src/document.js': 21,
  'src/drain.js': 4,
  'src/extract.js': 4,
  'src/feed.js': 11,
  'src/lookup.js': 1,
  'src/plugin.js': 1,
  'src/precache.js': 2,
  'src/prerender.js': 4,
  'src/project.js': 1,
  'src/proxy.js': 11,
  'src/routes.js': 1,
  'src/runtime/index.js': 82,
  'src/server.js': 1,
  'src/sitemap.js': 6,
  'src/typecheck.js': 6,
};

test('the checker still runs, and the report is readable', () => {
  const counted = errors();
  assert.ok(counted.size > 0 || Object.keys(CEILING).length === 0, 'tsc reported nothing at all');
  for (const file of counted.keys()) {
    assert.doesNotMatch(file, /^\s/, `parsed a continuation line as a file: ${file}`);
  }
});

test('no file type checks worse than it did', (t) => {
  const counted = errors();
  const worse = [];
  const better = [];

  for (const [file, count] of counted) {
    const allowed = CEILING[file] ?? 0;
    if (count > allowed) worse.push(`  ${file}: ${count}, and the ceiling is ${allowed}`);
  }

  for (const [file, allowed] of Object.entries(CEILING)) {
    const count = counted.get(file) ?? 0;
    if (count < allowed) better.push(`  '${file}': ${count},`);
  }

  // Reported, not failed. A ceiling above where a file actually sits is safe:
  // it can only ever be lowered, and nothing can slip under it that the check
  // above would not catch. Failing on it would mean a change that improves a
  // file it never meant to touch turns the build red and hands the author a
  // chore, which teaches people to leave files alone.
  // One call per file: a diagnostic is one TAP line, so an embedded newline
  // arrives as the characters `\n` rather than as a break.
  if (better.length) {
    t.diagnostic('these improved. Lower them when it suits:');
    for (const line of better) t.diagnostic(line.trim());
  }

  assert.deepEqual(worse, [], `these got worse:\n${worse.join('\n')}`);
});
