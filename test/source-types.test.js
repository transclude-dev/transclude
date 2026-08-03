// The framework's own source, type-checked.
//
// `npm run check` checks an *app*, through the shim the compiler builds. Nothing
// checked `src/` itself, and a function survived in `plugin.js` whose every path
// was a ReferenceError: it called two names that did not exist, and it was
// called from nowhere, so no test could reach it. It was found by pointing tsc
// at the source by hand. This is that, kept.
//
// The gate is a list of error codes rather than "zero errors". Most of what tsc
// says about this source is about the shape of a parse5 node, which the compiler
// walks loosely on purpose and which no annotation would make more correct. The
// codes below are different: each one means a name, an arity or a call that
// cannot be right, and each has already caught something real.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// `url.pathname` percent-encodes a space, and this project lives under a path
// with one in it.
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** Codes that cannot be a false positive here, and what each one caught. */
const FATAL = new Map([
  ['TS2304', 'a name that does not exist'],
  ['TS2552', 'a name that does not exist, with a suggestion'],
  ['TS2551', 'a property that does not exist, with a suggestion'],
  ['TS2554', 'the wrong number of arguments'],
  ['TS2349', 'calling something that is not a function'],
  ['TS2580', 'a runtime global with no type definition'],
]);

test('the framework source has no impossible names, arities or calls', () => {
  let output = '';
  try {
    execFileSync('npx', ['tsc', '-p', 'tsconfig.src.json'], { cwd: root, encoding: 'utf8' });
  } catch (error) {
    // tsc exits non-zero whenever it reports anything, including the codes this
    // test does not gate on, so the output is what matters rather than the code.
    output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
  }

  const caught = output
    .split('\n')
    .filter((line) => [...FATAL.keys()].some((code) => line.includes(`error ${code}:`)));

  assert.deepEqual(caught, [], `\n${caught.join('\n')}\n`);
});
