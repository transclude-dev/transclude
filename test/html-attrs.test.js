// What a loader can put on <html>.
//
// `lang` was the only thing configurable, which left no way to say `dir="rtl"`
// or to render a stored theme preference onto the element the CSS keys off.

import test from 'node:test';
import assert from 'node:assert/strict';

import { htmlAttrsOf, renderDocument, renderRoute, responseOf } from '../src/document.js';

const pageOf = (over = {}) => ({
  layouts: [],
  css: '',
  headScript: '',
  hasTitle: false,
  renderTitle: () => '',
  renderHead: () => '',
  elements: [],
  regions: {},
  load: async () => ({}),
  render: () => ({ default: '<p>x</p>' }),
  ...over,
});

const ctxOf = () => ({
  url: 'http://x/',
  params: {},
  route: { id: 'index', pattern: '/', path: '/' },
  request: null,
  fragment: null,
  action: null,
  response: responseOf(),
  htmlAttrs: htmlAttrsOf(),
});

const openTag = (html) => html.match(/<html[^>]*>/)[0];

test('a document with nothing added still says lang', () => {
  assert.equal(openTag(renderDocument([pageOf()], [{}])), '<html lang="en">');
});

test('a loader can add an attribute, and lang comes first', async () => {
  const ctx = ctxOf();
  const page = pageOf({
    load: async (c) => {
      c.htmlAttrs['data-theme'] = 'dark';
      return {};
    },
  });

  assert.equal(openTag(await renderRoute(page, ctx)), '<html lang="en" data-theme="dark">');
});

test('a layout sets it and the page below adds to the same object', async () => {
  // Shared by reference, the way the response is. A copy would drop whichever
  // one wrote first.
  const ctx = ctxOf();
  const layout = pageOf({
    load: async (c) => {
      c.htmlAttrs['data-theme'] = 'dark';
      return {};
    },
    render: (_d, slots) => ({ default: slots.default ?? '' }),
  });
  const page = pageOf({
    layouts: [layout],
    load: async (c) => {
      c.htmlAttrs.dir = 'rtl';
      return {};
    },
  });

  assert.equal(openTag(await renderRoute(page, ctx)), '<html lang="en" data-theme="dark" dir="rtl">');
});

test('lang can be overridden by a loader', async () => {
  const ctx = ctxOf();
  const page = pageOf({
    load: async (c) => {
      c.htmlAttrs.lang = 'ar';
      return {};
    },
  });

  assert.equal(openTag(await renderRoute(page, ctx)), '<html lang="ar">');
});

test('a value is escaped, because it usually came from a cookie', () => {
  // The reason this exists is rendering a stored preference, and a cookie is
  // whatever the client sent.
  const html = renderDocument([pageOf()], [{}], {
    htmlAttrs: { 'data-theme': '"><script>alert(1)</script>' },
  });

  assert.doesNotMatch(html, /<script>alert/);
  assert.match(openTag(html), /data-theme="&quot;&gt;&lt;script&gt;/);
});

test('true writes the name bare, false and null drop it', () => {
  const html = renderDocument([pageOf()], [{}], {
    htmlAttrs: { inert: true, hidden: false, dir: null },
  });

  assert.equal(openTag(html), '<html lang="en" inert>');
});

test('a name that could break out of the tag is refused', () => {
  for (const name of ['data theme', 'x>y', 'data-"x', 'Data-Theme']) {
    assert.throws(
      () => renderDocument([pageOf()], [{}], { htmlAttrs: { [name]: 'x' } }),
      /cannot be an attribute on <html>/,
      `${name} should be refused`,
    );
  }
});

test('the object has no prototype, so `constructor` is just a name', () => {
  const attrs = htmlAttrsOf();
  assert.equal(Object.getPrototypeOf(attrs), null);
  assert.equal(attrs.constructor, undefined);
});
