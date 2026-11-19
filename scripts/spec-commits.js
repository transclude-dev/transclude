#!/usr/bin/env node
// Fails when one commit changes both `src/` and expected output.
//
//   node scripts/spec-commits.js origin/main..HEAD
//
// A change to an expected file is its own commit, prefixed `spec:`, so it can
// be read on its own. A commit that changes the code and the answer the code
// is held to at once is the one the contract is there to stop: the test moved
// to meet the code. CI runs this over a pull request's commits and over what a
// push to `main` brings in. Merge commits are left out, because a merge's diff
// is its branch's commits, which are each checked.

import { execFileSync } from 'node:child_process';

const EXPECTED = /^spec\/cases\/[^/]+\/[^/]+\/(?:expected\/.+|expect\.json)$/;
const CODE = /^src\//;

const range = process.argv[2];
if (!range) {
  console.error('usage: node scripts/spec-commits.js <base>..<head>');
  process.exit(1);
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const commits = git('rev-list', '--no-merges', range).split('\n').filter(Boolean);

const mixed = [];
for (const commit of commits) {
  const files = git('diff-tree', '--no-commit-id', '--name-only', '-r', commit).split('\n');
  const code = files.filter((file) => CODE.test(file));
  const expected = files.filter((file) => EXPECTED.test(file));
  if (code.length && expected.length) {
    mixed.push(`${git('log', '-1', '--format=%h %s', commit)}\n    src: ${code.join(', ')}\n    expected: ${expected.join(', ')}`);
  }
}

if (mixed.length) {
  console.error(`A commit changes both src/ and expected output. Split it: the expected files go in a spec: commit of their own.\n`);
  for (const one of mixed) console.error(`  ${one}`);
  process.exit(1);
}
console.log(`${commits.length} commits, none changing src/ and expected output together`);
