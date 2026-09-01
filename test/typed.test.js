// `npm run check:src`, run.
//
// The framework type checks its own source through JSDoc, and 476 errors had
// accumulated because the script existed and no job ran it. Nearly all of them
// were one shape: a parameter documented `@param {object}`, which says opaque,
// so every read of a field on it was an error.
//
// This was a ratchet for a while, a ceiling per file that could only come down.
// The ceilings are gone because the count is zero: what replaced them is a name
// for each thing that gets passed around, written once where the thing lives.
// `Config`, `Manifest`, `Route`, `Entry`, `Ctx`, `PageModule`, `Definition`,
// `Block`, `ParsedNode` and `AcornNode` are most of it.
//
// A framework that sells "types without writing TypeScript" and does not type
// check its own source is a claim with nothing behind it. Now there is this.
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
 * tsc over `tsconfig.src.json`, and whatever it printed.
 *
 * @param {string[]} [extra] flags
 * @returns {{ ok: boolean, output: string }}
 */
function run(extra = []) {
  try {
    const output = execFileSync('npx', ['tsc', '-p', 'tsconfig.src.json', ...extra], {
      cwd: root,
      encoding: 'utf8',
    });
    return { ok: true, output };
  } catch (err) {
    return { ok: false, output: String(err.stdout ?? err.message ?? '') };
  }
}

test('the framework type checks its own source', () => {
  const { ok, output } = run();

  // Only a line that opens with `path(line,col): error TS` is a diagnostic. A
  // message can run to several lines, and the continuations are indented prose.
  const diagnostics = output
    .split('\n')
    .filter((line) => /^[^(\s][^(]*\(\d+,\d+\): error TS\d+:/.test(line));

  assert.deepEqual(
    diagnostics,
    [],
    `\`npm run check:src\` is red:\n${diagnostics.join('\n')}`,
  );
  assert.ok(ok, `tsc exited non-zero and printed:\n${output}`);
});

test('the checker is really pointed at this tree', () => {
  // Zero errors and a checker that opened nothing look exactly alike from the
  // outside, and the second one is what a broken invocation gives. So ask tsc
  // what it read. This is the guard the ceiling table used to be: while the
  // count was above zero, a report of none was the tell.
  const { output } = run(['--listFiles', '--noEmit']);
  const read = output.split('\n').map((line) => line.trim());

  for (const rel of ['src/app.js', 'src/compiler/index.js', 'src/runtime/index.js']) {
    assert.ok(
      read.some((file) => file.endsWith(rel)),
      `tsc never opened ${rel}, so a clean report says nothing`,
    );
  }
});
