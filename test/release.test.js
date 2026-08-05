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
