// `<transclude-fragment src="#id">` — the same page's own region, twice.
//
// The literal case the framework is named after. A region is already compiled to
// a function of the page's data, so including it costs a call and there is still
// only one copy of the markup.

import test from 'node:test';
import assert from 'node:assert/strict';

import { compilePage } from '../src/compiler/index.js';

const pageOf = (source) => compilePage(source, 'index.html', {});
const fails = (source) => {
  try {
    pageOf(source);
    return null;
  } catch (error) {
    return error.message;
  }
};

/** Run a compiled page's render against some data. */
const await0 = (source, data = {}) => renderSync(source, data);

function renderSync(source, data = {}) {
  const { code } = pageOf(source);
  const body = code
    .replace(/^import[^\n]*\n/gm, '')
    .replace(/^export /gm, '');

  const module = new Function(
    '__e', '__a', '__str', '__sh', '__data', 'html',
    `${body}; return { render, regions };`,
  )(
    (v) => String(v ?? ''),
    (n, v) => (v == null || v === false ? '' : ` ${n}="${String(v)}"`),
    (v) => String(v ?? ''),
    () => '',
    (def, props) => props,
    (v) => v,
  );

  // A page renders to its slots, and the body is the default one.
  return module.render(data).default;
}

const render = async (source, data = {}) => renderSync(source, data);

// ---- what it emits ---------------------------------------------------------

test('an include compiles to a call to the region it names', () => {
  const source =
    '<div id="pricing" fragment><p>The price.</p></div>' +
    '<transclude-fragment src="#pricing"></transclude-fragment>';

  assert.match(pageOf(source).code, /__o \+= regions\["pricing"\]\(__d, \{\}, false, false\)/);
});

test('the same markup appears in both places, from one compiled region', () => {
  const source =
    '<main><div id="pricing" fragment><p>The price.</p></div></main>' +
    '<aside><transclude-fragment src="#pricing"></transclude-fragment></aside>';

  return render(source).then((html) => {
    assert.equal(html.match(/<p>The price\.<\/p>/g).length, 2);
    // Same content, and only the region where it is declared answers to the id.
    assert.match(html, /<main><div id="pricing"><p>The price\.<\/p><\/div><\/main>/);
    assert.match(html, /<aside><div><p>The price\.<\/p><\/div><\/aside>/);
  });
});

test('the element itself leaves no trace', async () => {
  // A region is several nodes where it is declared. A wrapper here would mean
  // the two spellings rendered differently, which is the thing being avoided.
  const html = await render(
    '<p id="a" fragment>one</p><transclude-fragment src="#a"></transclude-fragment>',
  );

  assert.doesNotMatch(html, /transclude-fragment/);
});

test('an include reads the page data, since a region is a function of it', async () => {
  const source =
    '<script server>export default async () => ({ name: "Ada" });</script>' +
    '<p id="who" fragment>${name}</p>' +
    '<transclude-fragment src="#who"></transclude-fragment>';

  const html = await render(source, { name: 'Ada' });
  assert.equal(html.match(/Ada/g).length, 2);
});

test('a region can be included before it is declared', async () => {
  // Document order is not resolution order: the call is by name and the regions
  // object holds every one of them.
  const html = await render(
    '<transclude-fragment src="#later"></transclude-fragment><p id="later" fragment>x</p>',
  );

  assert.match(html, /^<p>x<\/p><p id="later">x<\/p>$/);
});

test('one region can be included in several places', async () => {
  const html = await render(
    '<p id="a" fragment>x</p>' +
      '<transclude-fragment src="#a"></transclude-fragment>' +
      '<transclude-fragment src="#a"></transclude-fragment>',
  );

  assert.equal(html.match(/<p( id="a")?>x<\/p>/g).length, 3);
  assert.equal(html.match(/id="a"/g).length, 1, 'a copy answered to the region name');
});

test('a region may include another one', async () => {
  const html = await render(
    '<p id="inner" fragment>in</p>' +
      '<div id="outer" fragment><transclude-fragment src="#inner"></transclude-fragment></div>' +
      '<transclude-fragment src="#outer"></transclude-fragment>',
  );

  // Once where it is declared, once inside the outer region, and once more
  // through the include of that region.
  assert.equal(html.match(/<p( id="inner")?>in<\/p>/g).length, 3);
  assert.equal(html.match(/id="inner"/g).length, 1);
  assert.equal(html.match(/id="outer"/g).length, 1);
});

// ---- what it refuses -------------------------------------------------------

test('a src naming no region of this page is a compile error', () => {
  const message = fails('<p id="a" fragment>x</p><transclude-fragment src="#nope"></transclude-fragment>');

  assert.match(message, /names no region of this page/);
  assert.match(message, /"fragment" attribute/, 'the message does not say how to make one');
});

test('an element with an id but no fragment attribute is not a region', () => {
  // The distinction the whole model rests on: an id is a handle, and a region is
  // something the author published.
  assert.match(
    fails('<p id="a">x</p><transclude-fragment src="#a"></transclude-fragment>'),
    /names no region/,
  );
});

test('a region including itself is refused, with the chain', () => {
  const message = fails('<div id="a" fragment><transclude-fragment src="#a"></transclude-fragment></div>');

  assert.match(message, /includes itself/);
  assert.match(message, /#a includes #a/);
});

test('a longer cycle is refused too, naming every step', () => {
  const message = fails(
    '<div id="a" fragment><transclude-fragment src="#b"></transclude-fragment></div>' +
      '<div id="b" fragment><transclude-fragment src="#c"></transclude-fragment></div>' +
      '<div id="c" fragment><transclude-fragment src="#a"></transclude-fragment></div>',
  );

  assert.match(message, /includes itself/);
  assert.match(message, /#a includes #b includes #c includes #a/);
});

test('including the same region twice is not a cycle', () => {
  const source =
    '<p id="a" fragment>x</p>' +
    '<div id="b" fragment>' +
    '<transclude-fragment src="#a"></transclude-fragment>' +
    '<transclude-fragment src="#a"></transclude-fragment>' +
    '</div>';

  assert.equal(fails(source), null);
});

test('a diamond is not a cycle', () => {
  // Two regions including one third. Nothing here fails to terminate, and a
  // cycle check that only counted visits would call this one.
  const source =
    '<p id="shared" fragment>x</p>' +
    '<div id="a" fragment><transclude-fragment src="#shared"></transclude-fragment></div>' +
    '<div id="b" fragment><transclude-fragment src="#shared"></transclude-fragment></div>';

  assert.equal(fails(source), null);
});

test('an empty or missing src is a compile error', () => {
  assert.match(fails('<transclude-fragment></transclude-fragment>'), /has no src/);
  assert.match(fails('<transclude-fragment src=""></transclude-fragment>'), /has no src/);
});

test('an interpolated src is refused, because it is not knowable', () => {
  const message = fails(
    '<p id="a" fragment>x</p><transclude-fragment src="#${name}"></transclude-fragment>',
  );

  assert.match(message, /interpolated src/);
});

test('a src naming another document says so rather than failing oddly', () => {
  const message = fails('<transclude-fragment src="https://example.com/x#a"></transclude-fragment>');
  assert.match(message, /not resolved yet/);
});

test('the tag is reserved, so an element file cannot shadow it', () => {
  // It is read before the component table, so a page using it gets the include
  // whatever an app put in elements/.
  const source = '<p id="a" fragment>x</p><transclude-fragment src="#a"></transclude-fragment>';
  const { code } = compilePage(source, 'index.html', {
    components: new Map([['transclude-fragment', { specifier: './x.js', tag: 'transclude-fragment' }]]),
    shadowTags: new Set(),
  });

  assert.match(code, /regions\["a"\]/);
});

test('an included copy does not answer to the region name', () => {
  // A region is always rendered where it is declared, so an include is always a
  // second copy in the same document. Both carrying the id would be invalid, and
  // a swap aimed at the region would find whichever came first.
  const html = await0(
    '<p id="a" fragment>x</p><transclude-fragment src="#a"></transclude-fragment>',
  );

  assert.equal(html, '<p id="a">x</p><p>x</p>');
});

test('the region still keeps its name when asked for on its own', async () => {
  // The fragment served over HTTP is the named one: that is what a swap
  // replaces, so it has to arrive with the id it is being matched against.
  const { code } = pageOf('<p id="a" fragment>x</p>');
  const body = code.replace(/^import[^\n]*\n/gm, '').replace(/^export /gm, '');
  const { regions } = new Function(
    '__e', '__a', '__str', '__sh', '__data', 'html',
    `${body}; return { regions };`,
  )((v) => String(v ?? ''), () => '', (v) => String(v ?? ''), () => '', (d, p) => p, (v) => v);

  assert.equal(regions.a({}), '<p id="a">x</p>');
});
