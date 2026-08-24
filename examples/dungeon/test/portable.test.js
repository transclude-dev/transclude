// Nothing in this app names one runtime.
//
// The same source runs on Node, Bun, Deno and workerd, and three of those are
// missing most of what a Node program reaches for. A `node:` import or a
// `process.env` in the request path works everywhere the tests run and fails on
// the one runtime the docs recommend deploying to, which is the direction nobody
// checks.
//
// Comments are stripped first. Two of the guards in the framework's own suite
// failed on the prose explaining the rule rather than on code breaking it, and
// the comment in `rng.js` names `node:crypto` on purpose.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'app');

/** Every `.js` and `.html` file under `app/`, as source. */
function sources(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(file));
    else if (/\.(js|html)$/.test(entry.name)) out.push([path.relative(app, file), fs.readFileSync(file, 'utf8')]);
  }
  return out;
}

/** The code, without the prose about the code. */
function code(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}

const files = sources(app);

test('there is something to check', () => {
  assert.ok(files.length >= 8, `only ${files.length} files found under app/`);
});

test('nothing imports from node:', () => {
  for (const [name, source] of files) {
    assert.doesNotMatch(code(source), /['"]node:/, `${name} names a node: module`);
  }
});

test('nothing reads a global only Node has', () => {
  // `crypto` and `URL` are globals on all four. `process`, `Buffer`,
  // `__dirname` and `require` are Node's alone.
  for (const [name, source] of files) {
    const body = code(source);

    assert.doesNotMatch(body, /\bprocess\s*\./, `${name} reads process`);
    assert.doesNotMatch(body, /\bBuffer\s*\./, `${name} reads Buffer`);
    assert.doesNotMatch(body, /\b__dirname\b/, `${name} reads __dirname`);
    assert.doesNotMatch(body, /\brequire\s*\(/, `${name} calls require`);
  }
});

test('nothing in the request path reads a clock or a die', () => {
  // A room renders from its URL and from nothing else. `Date.now()` or
  // `Math.random()` in a loader would make the same URL a different page on the
  // second read, which is the one promise this whole demo rests on. `mint` in
  // `rng.js` is the exception, and it runs in the entry endpoint rather than in
  // a render.
  for (const [name, source] of files) {
    if (name === path.join('lib', 'rng.js')) continue;

    const body = code(source);
    assert.doesNotMatch(body, /Math\.random\s*\(/, `${name} rolls a die`);
    assert.doesNotMatch(body, /Date\.now\s*\(|new Date\s*\(/, `${name} reads a clock`);
  }
});
