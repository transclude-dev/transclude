// `${}` inside a <script> or a <style>.
//
// Text in those two elements reaches the document raw, because escaping it would
// change what the browser reads: `&amp;` is an ampersand in prose and four
// characters in JavaScript. So an expression there lands in code, and a value
// that ends the statement it was written into runs whatever follows. No HTML
// escaping touches that, which is why the answer is a refusal and one narrow
// carve-out rather than a better escape.

import test from 'node:test';
import assert from 'node:assert/strict';

import { compilePage } from '../src/compiler/index.js';
import { json } from '../src/runtime/index.js';

const compile = (source) => compilePage(source, 'p.html', {}).code;
const fails = (source) => {
  try {
    compile(source);
    return null;
  } catch (error) {
    return error.message;
  }
};

// A page's own top-level <script> and <style> are read as blocks by the
// compiler. A nested one is markup, and that is the position under test.
const nested = (inner) => `<div>${inner}</div>`;

test('an expression in a script is refused', () => {
  const message = fails(nested('<script>var a = "${name}";</script>'));

  assert.match(message, /<script>/);
  assert.match(message, /json\(value\)/);
});

test('an expression in a style is refused, and names the escaped alternative', () => {
  const message = fails(nested('<style>.a { color: ${color} }</style>'));

  assert.match(message, /<style>/);
  assert.match(message, /custom property/);
});

test('json() alone is the one interpolation a script may carry', () => {
  const code = compile(nested('<script type="application/ld+json">${json(schema)}</script>'));

  // The runtime function, not a field of the page's data. Resolving it as data
  // would let the guard pass something the author never supplied.
  assert.match(code, /__str\(json\(__d\["schema"\]\)\)/);
});

test('json() has to be the whole script, and has to be json()', () => {
  // Anything either side of it is code again, and the value would be written
  // straight into it.
  assert.ok(fails(nested('<script>var a = ${json(a)};</script>')), 'text around it');
  assert.ok(fails(nested('<script>${json(a) + b}</script>')), 'concatenated');
  assert.ok(fails(nested('<script>${notJson(a)}</script>')), 'a different call');
});

test('a script with no expression is left alone', () => {
  assert.ok(compile(nested('<script>var a = 1;</script>')), 'a static script');
  assert.ok(compile(nested('<style>.a { color: red }</style>')), 'a static style');
});

// ---- what json() produces --------------------------------------------------

test('json() cannot end the script element', () => {
  const value = json({ a: '</script><img src=x onerror=alert(1)>' }).value;

  assert.doesNotMatch(value, /<\/script/i);
  assert.doesNotMatch(value, /<img/i);
  assert.equal(JSON.parse(value).a, '</script><img src=x onerror=alert(1)>');
});

test('json() escapes the two separators JSON allows raw and JavaScript does not', () => {
  // U+2028 and U+2029 are line terminators to a JavaScript parser and ordinary
  // string content to a JSON one, so a raw pair ends the statement.
  const value = json({ s: 'a\u2028b\u2029c' }).value;

  assert.doesNotMatch(value, /[\u2028\u2029]/);
  assert.equal(JSON.parse(value).s, 'a\u2028b\u2029c');
});

test('json() escapes the comment opener, which also shifts the tokenizer', () => {
  const value = json({ s: '<!--' }).value;

  assert.doesNotMatch(value, /<!--/);
  assert.equal(JSON.parse(value).s, '<!--');
});

test('json() of nothing is null rather than undefined', () => {
  // `JSON.stringify(undefined)` is undefined, and writing that into a script
  // would be a ReferenceError-shaped hole in the page.
  assert.equal(json(undefined).value, 'null');
  assert.equal(json(null).value, 'null');
});
