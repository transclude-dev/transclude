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

test('the grammar the manifest names parses and injects into HTML', () => {
  const manifest = JSON.parse(read('editor/vscode/package.json'));
  const [grammar] = manifest.contributes.grammars;

  const parsed = JSON.parse(read(path.join('editor/vscode', grammar.path)));
  assert.equal(parsed.scopeName, grammar.scopeName);
  assert.ok(grammar.injectTo.includes('text.html.basic'));
});
