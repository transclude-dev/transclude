// Attributes on `<html>`, written as `<html>`.
//
// `lang` was the only thing configurable, which left no way to say `dir="rtl"`
// or to render a stored theme onto the element the CSS keys off. It is a tag in
// the file now, hoisted the way `<title>` already is.

import test from 'node:test';
import assert from 'node:assert/strict';

import { compileLayout, compilePage, splitBlocks } from '../src/compiler/index.js';
import { renderDocument } from '../src/document.js';

const attrsOf = (source, filename = 'p') =>
  compilePage(source, { runtime: '/rt.js', filename }).code.match(
    /export function renderHtmlAttrs\(__d\) \{\n  return (.*);\n\}/,
  )[1];

const pageOf = (renderHtmlAttrs, over = {}) => ({
  layouts: [],
  css: '',
  headScript: '',
  hasTitle: false,
  renderTitle: () => '',
  renderHead: () => '',
  renderHtmlAttrs,
  elements: [],
  regions: {},
  render: () => ({ default: '<p>x</p>' }),
  ...over,
});

const openTag = (html) => html.match(/<html[^>]*>/)[0];

// ---- reading it out of the file -------------------------------------------

test('the fragment parser drops <html>, so it is read in document mode', () => {
  // A nested html start tag cannot appear in a body, so parse5 throws it away
  // attributes and all. Everything here rests on that second parse.
  const blocks = splitBlocks('<html dir="rtl">\n<p>x</p>');

  assert.equal(blocks.nodes.some((node) => node.nodeName === 'html'), false);
  assert.deepEqual(blocks.html.attrs, [{ name: 'dir', value: 'rtl' }]);
});

test('a file with no <html> compiles to nothing to merge', () => {
  assert.equal(attrsOf('<p>x</p>'), '{}');
});

test('a static attribute is a literal', () => {
  assert.equal(attrsOf('<html dir="rtl">\n<p>x</p>'), '{ "dir": "rtl" }');
});

test('an interpolated attribute reads the loader', () => {
  assert.match(attrsOf('<html data-theme="${theme}">\n<p>x</p>'), /"data-theme": __d\["theme"\]/);
});

test('a bare attribute is true, the way it is everywhere else', () => {
  assert.equal(attrsOf('<html inert>\n<p>x</p>'), '{ "inert": true }');
});

test('<html> written inside a script block is a string, not a tag', () => {
  // The real parser reads it, which is why a search for the text would be wrong
  // and this is not that.
  const source = [
    '<script server>',
    '  export default async () => ({ a: \'<html dir="rtl">\' });',
    '</script>',
    '<p>x</p>',
  ].join('\n');

  assert.equal(attrsOf(source), '{}');
});

test('a layout carries one too, which is where the document is owned', () => {
  const { code } = compileLayout('<html data-theme="${theme}">\n<slot></slot>', {
    id: 'root',
    runtime: '/rt.js',
  });

  assert.match(code, /export function renderHtmlAttrs/);
  assert.match(code, /"data-theme": __d\["theme"\]/);
});

// ---- what reaches the document --------------------------------------------

test('a document with none still says lang', () => {
  assert.equal(openTag(renderDocument([pageOf(() => ({}))], [{}])), '<html lang="en">');
});

test('a page writes its own', () => {
  const html = renderDocument([pageOf(() => ({ 'data-theme': 'dark' }))], [{}]);
  assert.equal(openTag(html), '<html lang="en" data-theme="dark">');
});

test('the chain merges by name, innermost winning per attribute', () => {
  // A root layout setting the theme and a page setting `dir` both survive, which
  // replacing outright would not do.
  const layout = pageOf(() => ({ 'data-theme': 'dark', dir: 'ltr' }));
  const page = pageOf(() => ({ dir: 'rtl' }));

  const html = renderDocument([layout, page], [{}, {}]);
  assert.equal(openTag(html), '<html lang="en" data-theme="dark" dir="rtl">');
});

test('lang can be overwritten', () => {
  const html = renderDocument([pageOf(() => ({ lang: 'ar' }))], [{}]);
  assert.equal(openTag(html), '<html lang="ar">');
});

test('a value is escaped, because it usually came from a cookie', () => {
  const html = renderDocument(
    [pageOf(() => ({ 'data-theme': '"><script>alert(1)</script>' }))],
    [{}],
  );

  assert.doesNotMatch(html, /<script>alert/);
  assert.match(openTag(html), /data-theme="&quot;&gt;&lt;script&gt;/);
});

test('true writes the name bare, false and null drop it', () => {
  const html = renderDocument([pageOf(() => ({ inert: true, hidden: false, dir: null }))], [{}]);
  assert.equal(openTag(html), '<html lang="en" inert>');
});

test('a name that could break out of the tag is refused', () => {
  for (const name of ['data theme', 'x>y', 'Data-Theme']) {
    assert.throws(
      () => renderDocument([pageOf(() => ({ [name]: 'x' }))], [{}]),
      /cannot be an attribute on <html>/,
      `${name} should be refused`,
    );
  }
});

test('a module with no renderHtmlAttrs still renders', () => {
  // It is called optionally, so a page module built before this existed is not
  // a crash on every request.
  const html = renderDocument([pageOf(undefined)], [{}]);
  assert.equal(openTag(html), '<html lang="en">');
});
