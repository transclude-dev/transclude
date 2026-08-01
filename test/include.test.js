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

test('a src naming another document is recorded for the server to resolve', () => {
  const { code } = pageOf('<transclude-fragment src="https://example.com/x#a"></transclude-fragment>');

  assert.match(code, /export const includes = \[\{"key":"https:\/\/example\.com\/x#a"/);
  assert.match(code, /"kind":"external","where":"https:\/\/example\.com\/x","id":"a"/);
});

test('a URL with no fragment says what is missing', () => {
  assert.match(
    fails('<transclude-fragment src="https://example.com/x"></transclude-fragment>'),
    /names a document but no piece of it/,
  );
});

test('a src naming another route of this app is recorded as one', () => {
  const { code } = pageOf('<transclude-fragment src="/docs/install#setup"></transclude-fragment>');
  assert.match(code, /"kind":"route","where":"\/docs\/install","id":"setup"/);
});

test('a src that is none of the three says all three', () => {
  const message = fails('<transclude-fragment src="docs/install#a"></transclude-fragment>');
  assert.match(message, /"#id".*"\/path#id".*absolute URL/s);
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

// ---- a document somebody else wrote ----------------------------------------

import { renderRoute, responseOf } from '../src/document.js';
import { included } from '../src/runtime/index.js';

const pageWith = (source, includes, body) => ({
  layouts: [],
  css: '',
  headScript: '',
  hasTitle: false,
  renderTitle: () => '',
  renderHead: () => '',
  renderHtmlAttrs: () => ({}),
  elements: [],
  regions: {},
  includes,
  load: async () => ({}),
  render: (data) => ({ default: body(data) }),
});

const ctxOf = () => ({
  url: 'http://x/',
  params: {},
  route: { id: 'index', pattern: '/', path: '/' },
  request: null,
  fragment: null,
  action: null,
  response: responseOf(),
});

const KEY = 'https://source.example/guide#intro';
const EXTERNALS = [{ key: KEY, kind: 'external', where: 'https://source.example/guide', id: 'intro' }];

test('an external include is resolved before the render, and lands in the markup', async () => {
  const asked = [];
  const html = await renderRoute(
    pageWith(null, EXTERNALS, (d) => `<main>${d.__included[KEY]}</main>`),
    ctxOf(),
    {
      include: {
        resolve: async (url, id) => (asked.push([url, id]), '<h2>Intro</h2>'),
      },
    },
  );

  assert.deepEqual(asked, [['https://source.example/guide', 'intro']]);
  assert.match(html, /<main><h2>Intro<\/h2><\/main>/);
});

test('several includes are resolved together, not one after another', async () => {
  // Ten includes off one page should be one round of work.
  let open = 0;
  let most = 0;
  const externals = ['a', 'b', 'c'].map((id) => ({
    key: `https://source.example/g#${id}`,
    kind: 'external',
    where: 'https://source.example/g',
    id,
  }));

  await renderRoute(pageWith(null, externals, () => 'x'), ctxOf(), {
    include: {
      resolve: async () => {
        open += 1;
        most = Math.max(most, open);
        await Promise.resolve();
        open -= 1;
        return 'y';
      },
    },
  });

  assert.equal(most, 3, 'they were resolved in sequence');
});

test('a source that throws leaves null, so the element can fall back', async () => {
  const html = await renderRoute(
    pageWith(null, EXTERNALS, (d) => `<main>${d.__included[KEY] ?? 'fallback'}</main>`),
    ctxOf(),
    { include: { resolve: async () => { throw new Error('down'); } } },
  );

  assert.match(html, /fallback/);
});

test('an external include with no allowed host says so rather than rendering a hole', async () => {
  await assert.rejects(
    () => renderRoute(pageWith(null, EXTERNALS, () => 'x'), ctxOf(), {}),
    /no host is allowed to be read.*proxy\.allow/s,
  );
});

test('a page with no externals resolves nothing and needs no config', async () => {
  const html = await renderRoute(pageWith(null, [], () => '<p>plain</p>'), ctxOf(), {});
  assert.match(html, /<p>plain<\/p>/);
});

// ---- what the compiled page does with the answer ---------------------------

test('the fragment is used when it came back, and the children are dropped', () => {

  assert.equal(
    included({ __included: { [KEY]: '<h2>Intro</h2>' } }, KEY, '<p>fallback</p>'),
    '<h2>Intro</h2>',
  );
});

test('the children are used when it did not', () => {
  assert.equal(included({ __included: { [KEY]: null } }, KEY, '<p>fallback</p>'), '<p>fallback</p>');
  assert.equal(included({}, KEY, '<p>fallback</p>'), '<p>fallback</p>');
});

test('no children and no answer is a throw naming the src', () => {
  // A hole nobody wrote looks like content. Failing is the smaller surprise.
  assert.throws(() => included({}, KEY, null), new RegExp(KEY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});


