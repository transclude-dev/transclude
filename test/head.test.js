// `<title>`, `<meta>`, `<link>` and `<base>` are hoisted out of the body and
// into <head> when they sit at the top level of a page.
//
// Written after a directive on one was dropped without a word. `emitElement`
// switched the write target to the head buffer, but the branch that was supposed
// to guard it had already been written into the body buffer, so the condition
// wrapped nothing and the tag went out on every request. No error, no warning,
// and the page looked right until you read the source of one that should not
// have had it.

import test from 'node:test';
import assert from 'node:assert/strict';

import { splitBlocks } from '../src/compiler/index.js';
import { compileFragment } from '../src/compiler/codegen.js';
import * as rt from '../src/runtime/index.js';

/** The compiled parts of a page, without running any of them. */
const partsOf = (source) => compileFragment(splitBlocks(source).nodes, { page: true });

/** What one of those parts renders for a given loader result. */
const run = (code, data) =>
  new Function(
    '__e', '__a', '__str', '__sh', '__data', 'html', '__d', '__slots', '__fragment',
    `let __o = '';\n${code}\nreturn __o;`,
  )(rt.escape, rt.attr, rt.str, rt.shadow, rt.data, rt.html, data, {}, false);

const head = (source, data = {}) => run(partsOf(source).head, data);
const body = (source, data = {}) => run(partsOf(source).body, data);

// ---- the hoist itself ------------------------------------------------------

test('a top-level meta and link go to the head, not the body', () => {
  const source = '<meta name="robots" content="noindex"><link rel="me" href="/j"><p>text</p>';

  assert.match(head(source), /<meta name="robots" content="noindex">/);
  assert.match(head(source), /<link rel="me" href="\/j">/);
  assert.doesNotMatch(body(source), /<meta|<link/);
});

// ---- a condition on one ----------------------------------------------------

test('a false condition keeps a hoisted tag out of the head', () => {
  // The bug. This emitted the link whatever `older` was.
  assert.equal(head('<link rel="next" if="older" href="/2">', { older: false }), '');
});

test('a true condition emits it', () => {
  assert.equal(
    head('<link rel="next" if="older" href="/2">', { older: true }),
    '<link rel="next" href="/2">',
  );
});

test('the directive attribute is not emitted as an attribute', () => {
  assert.doesNotMatch(head('<meta name="a" if="yes" content="b">', { yes: true }), /\bif=/);
});

test('two hoisted tags each keep their own condition', () => {
  const source = '<link rel="next" if="older" href="/2"><meta name="robots" if="hide" content="noindex">';

  assert.equal(head(source, { older: true, hide: false }), '<link rel="next" href="/2">');
  assert.equal(head(source, { older: false, hide: true }), '<meta name="robots" content="noindex">');
  assert.equal(head(source, { older: false, hide: false }), '');
});

test('else picks the other one', () => {
  const source = '<meta name="robots" if="hide" content="noindex"><meta name="robots" else content="all">';

  assert.match(head(source, { hide: true }), /noindex/);
  assert.match(head(source, { hide: false }), /content="all"/);
  assert.doesNotMatch(head(source, { hide: false }), /noindex/);
});

test('else-if is a third answer, not a second one', () => {
  const source =
    '<link rel="a" if="one" href="/a">' +
    '<link rel="b" else-if="two" href="/b">' +
    '<link rel="c" else href="/c">';

  // Equality rather than a match: with the bug, all three were emitted every
  // time, and looking for one of them found it in all three cases.
  assert.equal(head(source, { one: true, two: true }), '<link rel="a" href="/a">');
  assert.equal(head(source, { one: false, two: true }), '<link rel="b" href="/b">');
  assert.equal(head(source, { one: false, two: false }), '<link rel="c" href="/c">');
});

// ---- a loop over them ------------------------------------------------------

test('each on a hoisted tag emits one per item, in the head', () => {
  const source = '<link each="url of preloads" rel="preload" href="${url}">';
  const out = head(source, { preloads: ['/a.css', '/b.css'] });

  assert.equal(out, '<link rel="preload" href="/a.css"><link rel="preload" href="/b.css">');
});

test('each over nothing emits nothing', () => {
  assert.equal(head('<link each="url of preloads" href="${url}">', { preloads: [] }), '');
});

// ---- what is refused -------------------------------------------------------

test('a chain that mixes a hoisted tag with an ordinary one is refused', () => {
  // The two halves would land in different buffers, so the else could not be an
  // else. Better said out loud than split silently.
  assert.throws(
    () => partsOf('<link rel="next" if="older" href="/2"><p else>the end</p>'),
    /hoisted into <head>.*is not/s,
  );
});

test('a directive on <title> is refused', () => {
  // Which level's title wins is settled at compile time, from whether a level
  // has one. A condition would leave the document untitled and the layout's
  // title already ruled out.
  assert.throws(() => partsOf('<title if="named">${name}</title>'), /<title> cannot carry a directive/);
  assert.throws(() => partsOf('<title each="t of ts">${t}</title>'), /<title> cannot carry a directive/);
});

test('a title with no directive is still fine', () => {
  const parts = partsOf('<title>Plain</title>');

  assert.equal(parts.hasTitle, true);
  assert.equal(run(parts.title, {}), '<title>Plain</title>');
});
