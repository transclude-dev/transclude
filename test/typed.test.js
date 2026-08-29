// A ratchet on `npm run check:src`, which is red and was in nothing.
//
// The framework type checks its own source through JSDoc, and 476 errors had
// accumulated because the script existed and no job ran it. Nearly all of them
// are one shape: a parameter documented `@param {object}`, which says "opaque"
// rather than a shape, so every read of a field on it is an error.
//
// Fixing them is a long job and this is not it. This stops the bleeding: every
// file has a ceiling, and a change that makes one worse fails here rather than
// in a review nobody ran. Lowering a ceiling is the work, and the failure names
// the number to write when a file improves.
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
  'bin/build.js': 4,
  'bin/check.js': 2,
  'bin/dev.js': 25,
  'bin/serve.bun.js': 1,
  'bin/serve.deno.js': 1,
  'bin/serve.js': 1,
  'src/after.js': 1,
  'src/app.js': 54,
  'src/cache.js': 7,
  'src/compiler/bind.js': 2,
  'src/compiler/codegen.js': 9,
  'src/compiler/index.js': 79,
  'src/compiler/script.js': 4,
  'src/compiler/shim.js': 13,
  'src/compiler/types.js': 16,
  'src/csp.js': 4,
  'src/defaults.js': 2,
  'src/document.js': 21,
  'src/drain.js': 4,
  'src/extract.js': 4,
  'src/feed.js': 11,
  'src/lookup.js': 1,
  'src/plugin.js': 10,
  'src/precache.js': 2,
  'src/prerender.js': 4,
  'src/production.js': 3,
  'src/project.js': 1,
  'src/proxy.js': 11,
  'src/routes.js': 11,
  'src/runtime/index.js': 82,
  'src/server.js': 1,
  'src/sitemap.js': 6,
  'src/typecheck.js': 17,
  'src/worker.js': 16,
};

test('the checker still runs, and the report is readable', () => {
  const counted = errors();
  assert.ok(counted.size > 0 || Object.keys(CEILING).length === 0, 'tsc reported nothing at all');
  for (const file of counted.keys()) {
    assert.doesNotMatch(file, /^\s/, `parsed a continuation line as a file: ${file}`);
  }
});

test('no file type checks worse than it did', () => {
  const counted = errors();
  const worse = [];

  for (const [file, count] of counted) {
    const allowed = CEILING[file] ?? 0;
    if (count > allowed) worse.push(`  ${file}: ${count}, and the ceiling is ${allowed}`);
  }

  assert.deepEqual(worse, [], `these got worse:\n${worse.join('\n')}`);
});

test('a ceiling that is too high is named, so it can be lowered', () => {
  const counted = errors();
  const slack = [];

  for (const [file, allowed] of Object.entries(CEILING)) {
    const count = counted.get(file) ?? 0;
    if (count < allowed) slack.push(`  '${file}': ${count},`);
  }

  assert.deepEqual(slack, [], `these improved. Write the new ceilings:\n${slack.join('\n')}`);
});
