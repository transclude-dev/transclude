// American spelling, which `design/voice.md` asks for and nothing checked.
//
// It drifted in the ordinary way: a comment said one thing, the README built
// from it said another, and the docs page about it said a third. Nobody was
// wrong on purpose and nothing failed.
//
// The words live in `scripts/spelling.js`, which the Claude Code hook runs too,
// so the rule is written once. This walks every file git tracks rather than a
// list of directories: a repository-wide lint that happens to live in the test
// suite. It needs no app, so it does not cross the boundary the other tests
// keep.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { BRITISH, findings, reads } from '../scripts/spelling.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** What to read: text this repository wrote, as git lists it. */
function ours() {
  const listed = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n');
  return listed.filter(reads);
}

test('there is something to read', () => {
  // A `git ls-files` that returns nothing passes every check below in silence.
  assert.ok(ours().length > 100, `only ${ours().length} files listed`);
});

test('every spelling is the American one', () => {
  const found = [];
  for (const file of ours()) {
    found.push(...findings(file, fs.readFileSync(path.join(root, file), 'utf8')));
  }

  assert.deepEqual(found, [], `British spellings, and this repository writes American:\n${found.join('\n')}`);
});

test('the list is pairs of two different words', () => {
  // A pair mapping a word to itself would refuse a spelling and then suggest the
  // same one, which reads as the lint being broken rather than the word being
  // wrong.
  const same = Object.entries(BRITISH).filter(([british, american]) => british === american);

  assert.deepEqual(same, []);
  assert.ok(Object.keys(BRITISH).length > 40, 'the list lost most of itself');
});
