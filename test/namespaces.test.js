// Where new markup is parsed, and in which namespace.
//
// The bug this was written after: a repeated block under an `<svg>` came back
// from a re-render in the HTML namespace. `document.createElement('svg')` is an
// HTMLUnknownElement, the parser never enters foreign content inside one, and
// every `<g>` and `<use>` parsed there is an HTMLUnknownElement too. They are in
// the document, they carry the right attributes, and they draw nothing. The
// first paint always looked right, because that one arrives through
// `setHTMLUnsafe` on the shadow root, where the parser does see a real `<svg>`.
//
// What a browser then does with the plan below is a browser's answer, and
// `examples/showcase/app/routes/check.html` is where it is asked. These are
// about the decision: it is made from three DOM properties and nothing else, so
// it can be checked here rather than only in Chrome.

import test from 'node:test';
import assert from 'node:assert/strict';

import { holderFor } from '../src/runtime/index.js';

const SVG = 'http://www.w3.org/2000/svg';
const MATHML = 'http://www.w3.org/1998/Math/MathML';
const HTML = 'http://www.w3.org/1999/xhtml';

/** A parent, as much of one as the decision reads. */
const parent = (namespaceURI, localName, attrs = {}) => ({
  nodeType: 1,
  namespaceURI,
  localName,
  tagName: localName.toUpperCase(),
  getAttribute: (name) => attrs[name] ?? null,
});

test('an HTML parent is its own context, the way it always was', () => {
  assert.deepEqual(holderFor(parent(HTML, 'tbody')), { tag: 'TBODY', wrap: null });
  assert.deepEqual(holderFor(parent(HTML, 'div')), { tag: 'DIV', wrap: null });
});

test('a parent that is not an element is a div', () => {
  // A text node, which is what a parentNode is when the block sits in one.
  assert.deepEqual(holderFor({ nodeType: 3 }), { tag: 'div', wrap: null });
});

test('an SVG parent is parsed inside a real <svg>', () => {
  // Not `createElement('svg')`, which is an HTMLUnknownElement and the whole
  // bug. A div holding a written-out `<svg>` is what puts the parser into
  // foreign content.
  assert.deepEqual(holderFor(parent(SVG, 'svg')), { tag: 'div', wrap: 'svg' });
  assert.deepEqual(holderFor(parent(SVG, 'g')), { tag: 'div', wrap: 'svg' });
  assert.deepEqual(holderFor(parent(SVG, 'clipPath')), { tag: 'div', wrap: 'svg' });
});

test('a MathML parent is the same rule, and was the same bug', () => {
  assert.deepEqual(holderFor(parent(MATHML, 'math')), { tag: 'div', wrap: 'math' });
  assert.deepEqual(holderFor(parent(MATHML, 'mrow')), { tag: 'div', wrap: 'math' });
});

test('inside <foreignObject> the children are HTML again', () => {
  // Measured in Chrome: wrapping these in an `<svg>` does not fix them, it
  // empties them. A `<div>` start tag in foreign content takes the parser out
  // of the `<svg>` entirely, so the wrapper comes back with no children at all
  // and the block throws on the first node it does not have.
  assert.deepEqual(holderFor(parent(SVG, 'foreignObject')), { tag: 'FOREIGNOBJECT', wrap: null });
  assert.deepEqual(holderFor(parent(SVG, 'desc')), { tag: 'DESC', wrap: null });
  assert.deepEqual(holderFor(parent(SVG, 'title')), { tag: 'TITLE', wrap: null });
});

test('<annotation-xml> is one of those only while it says it is', () => {
  const html = { encoding: 'text/html' };
  const xhtml = { encoding: 'APPLICATION/XHTML+XML' };
  const mathml = { encoding: 'application/mathml+xml' };

  assert.equal(holderFor(parent(MATHML, 'annotation-xml', html)).wrap, null);
  assert.equal(holderFor(parent(MATHML, 'annotation-xml', xhtml)).wrap, null, 'case and nothing else');
  assert.equal(holderFor(parent(MATHML, 'annotation-xml', mathml)).wrap, 'math');
  assert.equal(holderFor(parent(MATHML, 'annotation-xml')).wrap, 'math', 'no encoding is MathML');
});

test('a namespace nobody knows is left alone', () => {
  assert.deepEqual(holderFor(parent('urn:example', 'thing')), { tag: 'THING', wrap: null });
});

test('the namespace table is a Map, because a namespace is a string off the DOM', () => {
  // `document.createElementNS('constructor', 'x')` is a thing somebody can
  // write, and a plain object lookup answers it with a function from
  // `Object.prototype`. The same shape as the region lookup in `app.js` and the
  // extension lookup in `mime.js`.
  for (const name of ['constructor', '__proto__', 'toString']) {
    assert.deepEqual(holderFor(parent(name, 'x')), { tag: 'X', wrap: null }, name);
  }
});
