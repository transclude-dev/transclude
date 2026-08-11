// The release tag carries the notes, and `publish.yml` makes the release page
// from them. That is one copy rather than two, and it only works if the message
// git stores is the message that was handed to it.
//
// The first test is the hazard, run against real git rather than described: the
// default cleanup treats a line beginning with `#` as a comment, so markdown
// headings disappear and the paragraphs under them stay. Nothing errors, the
// release page is just missing its structure.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const NOTES = `Icons are a directory of SVG files now.

## Before you upgrade

\`iconsDir\` defaults to \`'icons'\`, so a project already keeping SVGs in
\`app/icons/\` starts emitting \`/icons.svg\`.
`;

/** A throwaway repository with one empty commit, so a tag has somewhere to point. */
function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-release-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });

  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  git('commit', '-q', '--allow-empty', '-m', 'init');

  return { git };
}

/** What `publish.yml` reads back out of the tag. */
const contentsOf = (git, tag) => git('tag', '-l', '--format=%(contents)', tag);

test("git's default cleanup eats a markdown heading", () => {
  // Falsification for the test below. If this ever stops being true, the flag
  // is no longer buying anything and the comment explaining it is wrong.
  const { git } = repo();
  git('tag', '-a', 'v0.0.1', '-m', NOTES);

  const stored = contentsOf(git, 'v0.0.1');
  assert.ok(!stored.includes('## Before you upgrade'), 'git kept the heading, so the flag is moot');
  assert.ok(stored.includes('starts emitting'), 'the paragraph under it is still there');
});

test('verbatim keeps the notes exactly as written', () => {
  const { git } = repo();
  // Trimmed, the way `notesFrom` hands them over. `%(contents)` ends every
  // message with one newline of its own, which is the only difference allowed.
  const notes = NOTES.trim();
  git('tag', '-a', 'v0.0.2', '--cleanup=verbatim', '-m', notes);

  assert.equal(contentsOf(git, 'v0.0.2'), `${notes}\n`);
});

test('the release script tags verbatim', () => {
  // The source, because the alternative is cutting a real release to find out.
  // A release with no `--cleanup=verbatim` publishes notes missing every
  // heading, and the tag is immutable by the time anyone reads the page.
  const source = fs.readFileSync(path.join(root, 'bin/release.js'), 'utf8');
  // `'-a'` in the match, because `git tag --list` is also in this file and
  // reading that one would pass whatever the real call said.
  const tagCall = source.match(/run\('git', \['tag', '-a'[^\]]*\]/);

  assert.ok(tagCall, 'bin/release.js no longer writes an annotated tag the way this expects');
  assert.match(tagCall[0], /--cleanup=verbatim/);
});

test('the release script refuses to tag without notes', () => {
  // The whole point: v0.1.0 and v0.1.1 went to npm with no release page, because
  // writing one was a step with nothing holding it.
  const source = fs.readFileSync(path.join(root, 'bin/release.js'), 'utf8');

  assert.match(source, /--notes/, 'there is no notes option');
  assert.match(source, /function notesFrom/, 'nothing reads the notes');
});

// ---- lockfiles ------------------------------------------------------------
//
// `bin/release.js` writes the two `package.json` manifests. It used to write
// only those, and nothing else ever corrected the lockfiles: `npm install` does
// not run in a release. So the root lockfile said 0.2.0 against a package.json
// of 0.10.2, and each app carried a linked `@transclude/core` entry from 0.1.0,
// 0.1.1, 0.2.0 or 0.8.2. Eight releases of drift, found by reading rather than
// by any check.

/** Every lockfile in the repository, with the key that names this package. */
function lockfiles() {
  const found = [['package-lock.json', '']];
  if (fs.existsSync(path.join(root, 'www', 'package-lock.json'))) {
    found.push(['www/package-lock.json', '..']);
  }
  const examples = path.join(root, 'examples');
  for (const entry of fs.existsSync(examples) ? fs.readdirSync(examples).sort() : []) {
    const rel = `examples/${entry}/package-lock.json`;
    if (fs.existsSync(path.join(root, rel))) found.push([rel, '../..']);
  }
  return found;
}

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));

test('every lockfile carries the version the package does', () => {
  const { version } = readJson('package.json');
  const wrong = [];

  for (const [rel, key] of lockfiles()) {
    const lock = readJson(rel);
    const found = key === '' ? lock.version : lock.packages[key]?.version;
    if (found !== version) wrong.push(`${rel}: ${found ?? 'no entry'}, not ${version}`);
  }

  assert.deepEqual(wrong, [], `lockfiles behind package.json:\n${wrong.join('\n')}`);
});

test('a linked entry carries the dependencies the package declares', () => {
  // The version alone is not enough. A linked entry is a copy of the manifest,
  // so a dependency added since the entry was written is missing from it, and
  // `npm ci` in that app installs a tree the package no longer asks for.
  const core = readJson('package.json');
  const wrong = [];

  for (const [rel, key] of lockfiles()) {
    if (key === '') continue;
    const linked = readJson(rel).packages[key];
    if (!linked) continue;

    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'engines']) {
      const mine = JSON.stringify(core[field] ?? null);
      const theirs = JSON.stringify(linked[field] ?? null);
      if (mine !== theirs) wrong.push(`${rel}: ${field} is ${theirs}, not ${mine}`);
    }
  }

  assert.deepEqual(wrong, [], `linked entries behind package.json:\n${wrong.join('\n')}`);
});

test('both packages carry one version', () => {
  assert.equal(readJson('create/package.json').version, readJson('package.json').version);
});
