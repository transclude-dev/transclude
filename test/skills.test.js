// The agent skills under `skills/`. Two things are checked: the frontmatter
// against the Agent Skills format, and every HTML example against the compiler
// that will really read it.
//
// The second one is the point. A skill is documentation an agent acts on
// without a human reading it first, so an example that no longer compiles is
// worse than a missing one: it is followed.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileComponent, compilePage, readFlags } from '../src/compiler/index.js';

// `fileURLToPath`, not `url.pathname`: a space in the project path stays
// percent-encoded in the second one.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillsDir = path.join(root, 'skills');

/** Every skill directory, by name. */
function skills() {
  return fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

/** The YAML frontmatter of a SKILL.md, as flat key to value. */
function frontmatter(source) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, 'SKILL.md opens with YAML frontmatter');

  const fields = {};
  for (const line of match[1].split('\n')) {
    const [, key, value] = line.match(/^([a-z-]+):\s*(.*)$/) ?? [];
    if (key) fields[key] = value;
  }
  return fields;
}

/** Every fenced block of one language across a skill's files. */
function blocks(dir, lang) {
  const files = [path.join(dir, 'SKILL.md')];
  const refs = path.join(dir, 'references');
  if (fs.existsSync(refs)) {
    for (const name of fs.readdirSync(refs)) files.push(path.join(refs, name));
  }

  const found = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const fence = new RegExp('```' + lang + '\\n([\\s\\S]*?)```', 'g');
    for (const [, code] of source.matchAll(fence)) {
      found.push({ file: path.relative(root, file), code });
    }
  }
  return found;
}

test('every skill has a directory name its frontmatter agrees with', () => {
  const names = skills();
  assert.ok(names.length, 'there is at least one skill');

  for (const name of names) {
    const file = path.join(skillsDir, name, 'SKILL.md');
    assert.ok(fs.existsSync(file), `${name}/SKILL.md exists`);

    const fields = frontmatter(fs.readFileSync(file, 'utf8'));

    // The format's own rules: lowercase alphanumerics and hyphens, no hyphen at
    // either end, none doubled, and the name is the directory.
    assert.equal(fields.name, name, `${name}: the name field matches the directory`);
    assert.match(fields.name, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${name}: the name is well formed`);
    assert.ok(fields.name.length <= 64, `${name}: the name is 64 characters or fewer`);

    assert.ok(fields.description, `${name}: there is a description`);
    assert.ok(
      fields.description.length <= 1024,
      `${name}: the description is 1024 characters or fewer`,
    );
  }
});

test('a skill body stays short enough to load', () => {
  // The format asks for under 500 lines, so detail belongs in references/.
  for (const name of skills()) {
    const lines = fs.readFileSync(path.join(skillsDir, name, 'SKILL.md'), 'utf8').split('\n').length;
    assert.ok(lines < 500, `${name}/SKILL.md is ${lines} lines, and the limit is 500`);
  }
});

test('every HTML example in a skill compiles', () => {
  const failures = [];

  for (const name of skills()) {
    for (const { file, code } of blocks(path.join(skillsDir, name), 'html')) {
      // A block declaring props or state is an element file. Anything else is
      // read the way a page is, which is also right for a usage snippet.
      const isElement = /<script (properties|state)>/.test(code);

      try {
        if (isElement) {
          const { shadow } = readFlags(code);
          compileComponent(code, { tag: 'x-example', shadow, runtime: '/rt.js' });
        } else {
          compilePage(code, { runtime: '/rt.js', filename: file });
        }
      } catch (error) {
        failures.push(`${file}: ${error.message.split('\n')[0]}`);
      }
    }
  }

  assert.deepEqual(failures, [], `skill examples the compiler refuses:\n${failures.join('\n')}`);
});
