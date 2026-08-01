// `<transclude-fragment loading="lazy">` — the half the browser fills in.

import test from 'node:test';
import assert from 'node:assert/strict';

import { compilePage, compileClientEntry } from '../src/compiler/index.js';
import { MAX_DEPTH, parseNodes, requestUrl } from '../src/runtime/include.js';

// ---- where the browser asks -------------------------------------------------

test('a route is asked with the query parameter the server already answers', () => {
  // Not a second convention. `?fragment=` is what a region is served under, and
  // this is the same URL anyone could type.
  assert.deepEqual(requestUrl('/docs/install#setup'), {
    kind: 'route',
    url: '/docs/install?fragment=setup',
  });
});

test('a route that already has a query keeps it', () => {
  assert.equal(requestUrl('/search?q=a#results').url, '/search?q=a&fragment=results');
});

test('another site goes through this origin, because a cross-origin fetch is refused', () => {
  const { kind, url } = requestUrl('https://source.example/guide#intro');

  assert.equal(kind, 'foreign');
  assert.match(url, /^\/_transclude\/proxy\?url=https%3A%2F%2Fsource\.example%2Fguide&id=intro$/);
});

test('the same document is not asked for over the network at all', () => {
  assert.deepEqual(requestUrl('#pricing'), { kind: 'self', id: 'pricing' });
});

test('a src with no id, or no src, is nothing to ask for', () => {
  assert.equal(requestUrl('/docs/install'), null);
  assert.equal(requestUrl('/docs/install#'), null);
  assert.equal(requestUrl(''), null);
  assert.equal(requestUrl(null), null);
});

test('an id needing escaping is escaped in both shapes', () => {
  assert.equal(requestUrl('/a#b c').url, '/a?fragment=b+c');
  assert.match(requestUrl('https://x.example/a#b c').url, /id=b%20c/);
});

// ---- what the compiler does with it ----------------------------------------

test('a lazy include stays in the markup instead of being resolved', () => {
  const { code } = compilePage(
    '<transclude-fragment src="/docs/install#setup" loading="lazy"><p>Loading…</p></transclude-fragment>',
    'index.html',
    {},
  );

  assert.match(code, /<transclude-fragment/);
  assert.match(code, /<p>Loading…<\/p>/, 'the placeholder was dropped');
  assert.match(code, /export const includes = \[\]/, 'the server was asked to resolve it');
});

test('without loading it is still resolved on the server', () => {
  const { code } = compilePage(
    '<transclude-fragment src="/docs/install#setup"></transclude-fragment>',
    'index.html',
    {},
  );

  assert.doesNotMatch(code, /<transclude-fragment/);
  assert.match(code, /"kind":"route"/);
});

test('a lazy include may have an interpolated src, since the server never reads it', () => {
  const { code } = compilePage(
    '<script server>export default async () => ({ slug: "x" });</script>' +
      '<transclude-fragment src="/docs/${slug}#intro" loading="lazy"></transclude-fragment>',
    'index.html',
    {},
  );

  assert.match(code, /__a\("src"/);
});

// ---- who ships the element --------------------------------------------------

test('the entry defines the element only when a page has one', () => {
  const withOne = compileClientEntry([{ source: '<p>x</p>', filename: 'a.html' }], { include: true }, {
    runtime: 'transclude/runtime',
  });
  const without = compileClientEntry([{ source: '<p>x</p>', filename: 'a.html' }], {}, {
    runtime: 'transclude/runtime',
  });

  assert.match(withOne.code, /defineInclude as __defineInclude/);
  assert.match(withOne.code, /__defineInclude\(\);/);
  assert.doesNotMatch(without.code, /defineInclude/);
});

// ---- parsing what comes back ------------------------------------------------

test('a declarative shadow root is attached, not left as a dead template', () => {
  // The quiet one. `innerHTML` and `DOMParser` both leave it inert, so a
  // component inside a fetched fragment would never paint and nothing would say
  // why.
  const seen = [];
  const doc = {
    createElement: () => ({
      childNodes: [],
      setHTMLUnsafe(html) {
        seen.push('setHTMLUnsafe');
        this.childNodes = [{ nodeType: 1, html }];
      },
      set innerHTML(html) {
        seen.push('innerHTML');
        this.childNodes = [{ nodeType: 1, html }];
      },
    }),
  };

  const nodes = parseNodes('<p>x</p>', doc);
  assert.deepEqual(seen, ['setHTMLUnsafe'], 'innerHTML was used, which skips shadow roots');
  assert.equal(nodes.length, 1);
});

test('the depth limit is a number the element can reach', () => {
  assert.equal(MAX_DEPTH, 10);
});
