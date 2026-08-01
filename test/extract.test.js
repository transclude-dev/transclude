// Cutting a fragment out of a document nobody wrote for us.
//
// Every case here is markup an author had no reason to prepare. If a rule needs
// cooperation from the source document, it is the wrong rule.

import test from 'node:test';
import assert from 'node:assert/strict';

import { listFragments, readDocument, resolveFragment, slugify } from '../src/extract.js';

/** Whitespace between tags is not the thing under test. */
const tidy = (html) => html.replace(/>\s+</g, '><').trim();
const htmlOf = (source, id) => tidy(resolveFragment(source, id).html);
const ids = (source) => listFragments(source).map((f) => f.id);

// ---- extent: headings ------------------------------------------------------

test('a heading absorbs the subsections under it', () => {
  const source = '<h2 id="a">A</h2><p>one</p><h3>Deeper</h3><p>two</p><h2>B</h2><p>three</p>';

  assert.equal(htmlOf(source, 'a'), '<h2 id="a">A</h2><p>one</p><h3>Deeper</h3><p>two</p>');
});

test('a heading stops at the next heading of its own rank', () => {
  const source = '<h2 id="a">A</h2><p>one</p><h2>B</h2><p>two</p>';
  assert.equal(htmlOf(source, 'a'), '<h2 id="a">A</h2><p>one</p>');
});

test('a deeper heading stops at a shallower one', () => {
  const source = '<h3 id="a">A</h3><p>one</p><h2>Up</h2><p>two</p>';
  assert.equal(htmlOf(source, 'a'), '<h3 id="a">A</h3><p>one</p>');
});

test('a heading with nothing after it runs to the end', () => {
  const source = '<p>before</p><h2 id="a">A</h2><p>one</p><p>two</p>';
  assert.equal(htmlOf(source, 'a'), '<h2 id="a">A</h2><p>one</p><p>two</p>');
});

test('a run stops at its parent, not at the next heading in the document', () => {
  // The section closes first. Reading past it would return markup that is not
  // under the heading at all.
  const source = '<section><h2 id="a">A</h2><p>one</p></section><p>outside</p><h2>B</h2>';
  assert.equal(htmlOf(source, 'a'), '<h2 id="a">A</h2><p>one</p>');
});

test('nested headings resolve independently', () => {
  const source =
    '<h2 id="install">Install</h2><p>intro</p>' +
    '<h3 id="install-macos">macOS</h3><p>mac</p>' +
    '<h3>Linux</h3><p>linux</p><h2 id="use">Use</h2>';

  assert.match(htmlOf(source, 'install'), /^<h2 id="install">.*<p>linux<\/p>$/);
  assert.equal(htmlOf(source, 'install-macos'), '<h3 id="install-macos">macOS</h3><p>mac</p>');
  assert.equal(htmlOf(source, 'use'), '<h2 id="use">Use</h2>');
});

test('text and comments between headings travel with the run', () => {
  const source = '<h2 id="a">A</h2>loose text<!--note--><p>one</p><h2>B</h2>';
  const html = resolveFragment(source, 'a').html;

  assert.match(html, /loose text/);
  assert.match(html, /<!--note-->/);
});

test('an hgroup is the unit, and terminates a run like a heading', () => {
  const source =
    '<h2 id="a">A</h2><p>one</p>' +
    '<hgroup><h2>B</h2><p>tagline</p></hgroup><p>two</p>';

  assert.equal(htmlOf(source, 'a'), '<h2 id="a">A</h2><p>one</p>');
});

test('a heading inside an hgroup returns the whole group', () => {
  const source = '<hgroup><h2 id="a">A</h2><p>tagline</p></hgroup><p>one</p><h2>B</h2>';

  assert.equal(
    htmlOf(source, 'a'),
    '<hgroup><h2 id="a">A</h2><p>tagline</p></hgroup><p>one</p>',
  );
});

// ---- extent: definition lists ---------------------------------------------

test('a term takes its definitions and stops at the next term', () => {
  const source =
    '<dl><dt id="a">A</dt><dd>one</dd><dd>two</dd><dd>three</dd><dt>B</dt><dd>four</dd></dl>';

  assert.equal(htmlOf(source, 'a'), '<dt id="a">A</dt><dd>one</dd><dd>two</dd><dd>three</dd>');
  assert.equal(resolveFragment(source, 'a').kind, 'dt-run');
});

// ---- extent: everything else ----------------------------------------------

test('anything that is not a heading or a term is returned as itself', () => {
  for (const [tag, source] of [
    ['section', '<section id="a"><h2>A</h2><p>one</p></section><p>after</p>'],
    ['figure', '<figure id="a"><img src="x.png"><figcaption>c</figcaption></figure><p>after</p>'],
    ['p', '<p id="a">one</p><p>two</p>'],
    ['my-widget', '<my-widget id="a"><span>x</span></my-widget><p>after</p>'],
  ]) {
    const result = resolveFragment(source, 'a');
    assert.equal(result.kind, 'element', tag);
    assert.equal(result.nodes.length, 1, tag);
    assert.doesNotMatch(result.html, /after/, tag);
  }
});

test('an id on body returns the whole page, with no special case for it', () => {
  const result = resolveFragment('<body id="a"><h2>A</h2><p>one</p></body>', 'a');

  assert.equal(result.kind, 'element');
  assert.match(result.html, /<h2>A<\/h2><p>one<\/p>/);
});

// ---- the empty bookmark ----------------------------------------------------

test('an empty anchor before a heading resolves the heading run', () => {
  const source = '<a id="install"></a><h2>Installing</h2><p>one</p><h2>Next</h2>';

  assert.equal(htmlOf(source, 'install'), '<h2>Installing</h2><p>one</p>');
  assert.equal(resolveFragment(source, 'install').kind, 'heading-run');
});

test('an empty anchor before a paragraph resolves the paragraph', () => {
  assert.equal(htmlOf('<a id="a"></a><p>one</p><p>two</p>', 'a'), '<p>one</p>');
});

test('an empty anchor with nothing after it is returned as itself', () => {
  const result = resolveFragment('<div><p>one</p><a id="a"></a></div>', 'a');
  assert.equal(tidy(result.html), '<a id="a"></a>');
});

test('an anchor with text is a real link and is returned as itself', () => {
  const result = resolveFragment('<a id="a" href="/x">Real link</a><p>one</p>', 'a');
  assert.equal(result.html, '<a id="a" href="/x">Real link</a>');
});

test('whitespace alone does not make an inline element real', () => {
  assert.equal(htmlOf('<span id="a">   \n </span><p>one</p>', 'a'), '<p>one</p>');
});

test('an image alone does make it real, even with no text', () => {
  const result = resolveFragment('<span id="a"><img src="x.png"></span><p>one</p>', 'a');
  assert.match(result.html, /<span id="a">/);
});

test('two empty anchors hop once, not twice', () => {
  // Chaining would walk past whatever sits between them.
  const result = resolveFragment('<a id="a"></a><a id="b"></a><p>one</p>', 'a');
  assert.equal(tidy(result.html), '<a id="b"></a>');
});

test('a block element with no text is not a bookmark', () => {
  const result = resolveFragment('<div id="a"></div><p>one</p>', 'a');
  assert.equal(result.html, '<div id="a"></div>');
});

// ---- standalone validity ---------------------------------------------------

test('a cell says it is not standalone, and names what it needs', () => {
  const source = '<table><tbody><tr><td id="a">one</td><td>two</td></tr></tbody></table>';
  const result = resolveFragment(source, 'a');

  assert.equal(result.standalone, false);
  const [note] = result.diagnostics.filter((d) => d.code === 'not-standalone');
  assert.deepEqual(note.ancestors, ['table', 'tbody', 'tr']);
});

test('a list item is not standalone either', () => {
  const result = resolveFragment('<ul><li id="a">one</li></ul>', 'a');
  assert.equal(result.standalone, false);
});

test('a term run is resolvable and still not standalone', () => {
  // Both true at once: the run is right, and it needs a <dl> to mean anything.
  const result = resolveFragment('<dl><dt id="a">A</dt><dd>one</dd></dl>', 'a');

  assert.equal(result.kind, 'dt-run');
  assert.equal(result.standalone, false);
  assert.deepEqual(result.diagnostics.find((d) => d.code === 'not-standalone').ancestors, ['dl']);
});

test('an ordinary element is standalone and says nothing about it', () => {
  const result = resolveFragment('<section id="a"><p>one</p></section>', 'a');

  assert.equal(result.standalone, true);
  assert.deepEqual(result.diagnostics, []);
});

// ---- ids -------------------------------------------------------------------

test('a missing id is null, not a throw', () => {
  assert.equal(resolveFragment('<p id="a">one</p>', 'nope'), null);
});

test('the first of two identical ids wins, and the duplicate is reported', () => {
  const result = resolveFragment('<p id="a">first</p><p id="a">second</p>', 'a');

  assert.match(result.html, /first/);
  assert.equal(result.diagnostics[0].code, 'duplicate-id');
});

test('an id is an exact string, not a selector', () => {
  // `.` and ` ` mean something to a CSS parser and nothing here.
  for (const id of ['a.b', 'a b', 'a:b', '安装']) {
    const result = resolveFragment(`<p id="${id}">one</p>`, id);
    assert.equal(result?.html, `<p id="${id}">one</p>`, id);
  }
});

test('matching is case-sensitive, the way a URL fragment is', () => {
  assert.equal(resolveFragment('<p id="Install">one</p>', 'install'), null);
});

test('an id inside a template is not addressable', () => {
  // Template content is inert: the source document renders none of it, so a URL
  // returning it would return something nobody could see on the page.
  const source = '<template><p id="a">hidden</p></template><p id="b">shown</p>';

  assert.equal(resolveFragment(source, 'a'), null);
  assert.equal(resolveFragment(source, 'b').html, '<p id="b">shown</p>');
});

// ---- generated slugs -------------------------------------------------------

test('a document with no ids is still addressable by heading', () => {
  const source = '<h2>Getting started</h2><p>one</p><h2>Configuration</h2><p>two</p>';

  assert.equal(htmlOf(source, 'getting-started'), '<h2>Getting started</h2><p>one</p>');
  assert.equal(resolveFragment(source, 'getting-started').implicit, true);
});

test('markup inside a heading is stripped from its slug', () => {
  const source = '<h2>Install <code>foo</code></h2><p>one</p>';
  assert.equal(resolveFragment(source, 'install-foo').implicit, true);
});

test('slugs keep their own script rather than folding to ASCII', () => {
  assert.equal(slugify('安装 指南'), '安装-指南');
  assert.equal(slugify('Café Münster'), 'café-münster');
});

test('punctuation goes, and hyphens and underscores stay', () => {
  assert.equal(slugify('What? Why! (Really)'), 'what-why-really');
  assert.equal(slugify('read_me — now'), 'read_me-now');
  assert.equal(slugify('  spaced   out  '), 'spaced-out');
});

test('an empty heading produces no slug', () => {
  assert.deepEqual(ids('<h2></h2><h2>Real</h2>'), ['real']);
  assert.deepEqual(ids('<h2>!!!</h2>'), []);
});

test('two headings with the same text are told apart in document order', () => {
  const source = '<h2>Notes</h2><p>one</p><h2>Notes</h2><p>two</p>';

  assert.deepEqual(ids(source), ['notes', 'notes-1']);
  assert.match(resolveFragment(source, 'notes').html, /one/);
  assert.match(resolveFragment(source, 'notes-1').html, /two/);
});

test('an explicit id anywhere wins, and the generated one steps aside', () => {
  // The explicit id is further down the document than the heading that would
  // have taken the name, so this only works if ids are all reserved first.
  const source = '<h2>Notes</h2><p>one</p><section id="notes"><p>two</p></section>';

  assert.match(resolveFragment(source, 'notes').html, /<section/);
  assert.match(resolveFragment(source, 'notes-1').html, /<h2>Notes<\/h2>/);
});

test('a heading that already has an id does not also get a slug', () => {
  assert.deepEqual(ids('<h2 id="chosen">Notes</h2>'), ['chosen']);
});

test('asking for one fragment does not change what another is called', () => {
  // The table is built for the whole document before anything is resolved. Doing
  // it per request would make a suffix depend on the order requests arrived in.
  const source = '<h2>Notes</h2><h2>Notes</h2><h2>Notes</h2>';
  const doc = readDocument(source);

  const first = resolveFragment(doc, 'notes-2').html;
  const fresh = readDocument(source);

  assert.equal(resolveFragment(fresh, 'notes-2').html, first);
  assert.deepEqual(ids(source), ['notes', 'notes-1', 'notes-2']);
});

// ---- listFragments ---------------------------------------------------------

test('the list reads like the document outline, in document order', () => {
  const source =
    '<h1>Guide</h1><h2 id="install">Install</h2><p>one</p>' +
    '<h3>macOS</h3><section id="notes"><p>two</p></section>';

  assert.deepEqual(listFragments(source), [
    { id: 'guide', implicit: true, tag: 'h1', rank: 1, kind: 'heading-run', text: 'Guide' },
    { id: 'install', implicit: false, tag: 'h2', rank: 2, kind: 'heading-run', text: 'Install' },
    { id: 'macos', implicit: true, tag: 'h3', rank: 3, kind: 'heading-run', text: 'macOS' },
    { id: 'notes', implicit: false, tag: 'section', rank: null, kind: 'element', text: 'two' },
  ]);
});

test('everything the list names resolves', () => {
  // The whole claim, in one assertion: run the rules over a document and every
  // fragment they advertise can be fetched.
  const source =
    '<a id="old"></a><h2>Install</h2><p>one</p>' +
    '<dl><dt id="term">T</dt><dd>d</dd></dl>' +
    '<table><tr><td id="cell">c</td></tr></table>' +
    '<h2>Install</h2><p>two</p><template><p id="hidden">no</p></template>';

  const doc = readDocument(source);
  for (const { id } of listFragments(doc)) {
    assert.ok(resolveFragment(doc, id), `${id} was listed but did not resolve`);
  }
  assert.ok(!listFragments(doc).some((f) => f.id === 'hidden'));
});

test('a parse is reusable across fragments', () => {
  // Several fragments usually come from one document, so the table is built once
  // and handed back in.
  const doc = readDocument('<h2 id="a">A</h2><p>one</p><h2 id="b">B</h2><p>two</p>');

  assert.match(resolveFragment(doc, 'a').html, /one/);
  assert.match(resolveFragment(doc, 'b').html, /two/);
});

// ---- shapes that turn up in documents nobody wrote for us -------------------

test('an outline comes out of markup with no ids at all', () => {
  // The shape a rendered README has: headings, lists, code, no ids anywhere.
  const source =
    '<h1>acme</h1><p>A thing.</p>' +
    '<h2>Install</h2><pre><code>npm i acme</code></pre>' +
    '<h3>From source</h3><p>Clone it.</p>' +
    '<h2>Usage</h2><ul><li>one</li><li>two</li></ul>' +
    '<h2>License</h2><p>MIT</p>';

  const doc = readDocument(source);
  assert.deepEqual(
    listFragments(doc).map((f) => `${f.tag}#${f.id}`),
    ['h1#acme', 'h2#install', 'h3#from-source', 'h2#usage', 'h2#license'],
  );

  // Install absorbs its subsection and stops at Usage.
  const install = resolveFragment(doc, 'install').html;
  assert.match(install, /From source/);
  assert.doesNotMatch(install, /Usage/);
});

test('an outline comes out of a page written before ids were put on headings', () => {
  // Empty anchors above headings, which is how the whole web did this once.
  const source =
    '<a name="top" id="top"></a><h1>Manual</h1>' +
    '<a id="setup"></a><h2>Setup</h2><p>Run it.</p>' +
    '<a id="opts"></a><h2>Options</h2><dl><dt>-v</dt><dd>verbose</dd></dl>';

  const doc = readDocument(source);
  const setup = resolveFragment(doc, 'setup');

  assert.equal(setup.kind, 'heading-run');
  assert.match(setup.html, /<h2>Setup<\/h2><p>Run it\.<\/p>/);
  assert.doesNotMatch(setup.html, /Options/);

  for (const { id } of listFragments(doc)) {
    assert.ok(resolveFragment(doc, id), `${id} was listed but did not resolve`);
  }
});

test('a page whose sections are wrapped resolves both the wrapper and the heading', () => {
  // Framework docs shape: <section id> around a heading that also gets a slug.
  const source =
    '<section id="intro"><h2>Intro</h2><p>one</p></section>' +
    '<section id="api"><h2>API</h2><p>two</p><h3>Methods</h3><p>three</p></section>';

  const doc = readDocument(source);

  // The wrapper is addressed by its own id and returns its whole subtree.
  assert.match(resolveFragment(doc, 'intro').html, /^<section id="intro">/);

  // The h2 inside it wanted "api", which the section already holds, so it took
  // the next name rather than the section's.
  assert.deepEqual(
    listFragments(doc).map((f) => f.id),
    ['intro', 'intro-1', 'api', 'api-1', 'methods'],
  );

  // That h2's run stops where its section closes, so it never reaches Methods'
  // sibling text from the following section.
  const api = resolveFragment(doc, 'api-1');
  assert.equal(api.kind, 'heading-run');
  assert.match(api.html, /<h3>Methods<\/h3><p>three<\/p>$/);
  assert.doesNotMatch(api.html, /<section/);
});
