// The VS Code extension, and the one mistake it already made.
//
// The extension ships no checker: it starts the language server from the
// project's own installed package. That lookup is a path written as a string,
// and it named `node_modules/transclude/…`, a package that does not exist. The
// server was found only inside this repository, so the extension worked for
// exactly the people who did not need it, and nothing errored anywhere.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('the extension looks for the package that exists', () => {
  const { name } = JSON.parse(read('package.json'));
  const extension = read('editor/vscode/extension.js');

  const looked = extension.match(/node_modules\/(\S+?)\/editor\/server\.js/)?.[1];
  assert.equal(looked, name, 'the server lookup names a different package');
});

test('the fallback the repository uses is a file', () => {
  const extension = read('editor/vscode/extension.js');

  assert.match(extension, /'editor\/server\.js'/);
  assert.ok(fs.existsSync(path.join(root, 'editor/server.js')));
});

test('the package ships the server the extension starts', () => {
  // `files` in package.json is the publish list. Losing `editor` from it would
  // install a package the extension searches and finds nothing in.
  const { files } = JSON.parse(read('package.json'));
  assert.ok(files.includes('editor'), 'editor is not published with the package');
});

test('every grammar the manifest names parses and injects into HTML', () => {
  const manifest = JSON.parse(read('editor/vscode/package.json'));
  assert.ok(manifest.contributes.grammars.length > 0);

  for (const grammar of manifest.contributes.grammars) {
    const parsed = JSON.parse(read(path.join('editor/vscode', grammar.path)));
    assert.equal(parsed.scopeName, grammar.scopeName);
    assert.ok(grammar.injectTo.includes('text.html.basic'), `${grammar.scopeName} injects nowhere`);
  }
});

test('the directives are matched inside a tag and nowhere else', () => {
  // `else`, `if` and `each` are ordinary English words. A selector reaching the
  // whole document highlighted them in prose: "nothing else matters" came out
  // with a keyword in the middle of it.
  const parsed = JSON.parse(read('editor/vscode/syntaxes/transclude.directives.json'));

  assert.match(parsed.injectionSelector, /meta\.tag/);
});

test('the grammar highlights every directive the compiler knows', () => {
  const listed = read('src/compiler/codegen.js').match(
    /const DIRECTIVES = new Set\(\[([^\]]+)\]\)/,
  )[1];
  const names = [...listed.matchAll(/'([^']+)'/g)].map(([, name]) => name);
  const parsed = JSON.parse(read('editor/vscode/syntaxes/transclude.directives.json'));

  // Only the patterns, so the word appearing in a comment does not count.
  const patterns = Object.values(parsed.repository)
    .flatMap((rule) => [rule.begin, rule.match, ...(rule.patterns ?? []).map((p) => p.match)])
    .filter(Boolean)
    .join('\n');

  assert.ok(names.length >= 6, 'the compiler set was not read');
  for (const name of names) {
    assert.ok(patterns.includes(name), `no pattern mentions the "${name}" directive`);
  }
});

test('a directive that takes a value consumes the whole attribute', () => {
  // Matching the name alone leaves the value to the HTML grammar, which has
  // already passed the point where an attribute may start. It scoped the `=` as
  // an illegal character and read the value's words as more attribute names, and
  // a `>` inside the value ended the tag and lost the rest of the line.
  const parsed = JSON.parse(read('editor/vscode/syntaxes/transclude.directives.json'));

  for (const name of ['each', 'expression']) {
    const rule = parsed.repository[name];
    assert.match(rule.begin, /\["']/, `${name} does not open on the quote`);
    assert.ok(rule.end, `${name} never closes, so the value is not consumed`);
  }
});
