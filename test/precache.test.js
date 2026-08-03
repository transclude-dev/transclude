// The list of what a build produced, for whoever wants to cache it.
//
// The framework ships no service worker. Only the build knows an asset's hashed
// name, so the list is the one part an app cannot write for itself.

import test from 'node:test';
import assert from 'node:assert/strict';

import { PRECACHE_PATH, precacheDocument, precacheList } from '../src/precache.js';

const map = (obj) => new Map(Object.entries(obj));

test('a hashed asset carries no revision, because its name is one', () => {
  const list = precacheList({
    pages: map({}),
    assets: map({ '/assets/app-a1b2c3.css': { etag: '"ignored"' } }),
  });

  assert.deepEqual(list, [{ url: '/assets/app-a1b2c3.css', revision: null }]);
});

test('a page carries its ETag, because its URL stays the same', () => {
  const list = precacheList({
    pages: map({ '/': { etag: '"abc"' }, '/notes': { etag: '"def"' } }),
    assets: map({}),
  });

  assert.deepEqual(list, [
    { url: '/', revision: '"abc"' },
    { url: '/notes', revision: '"def"' },
  ]);
});

test('a public file is a page for this purpose: stable URL, changing bytes', () => {
  const list = precacheList({
    pages: map({}),
    assets: map({}),
    files: map({ '/favicon.ico': { etag: '"ico"' } }),
  });

  assert.deepEqual(list, [{ url: '/favicon.ico', revision: '"ico"' }]);
});

test('a page with no ETag is refused rather than called immutable', () => {
  // `revision: null` means "this URL never changes". A page that lost its ETag
  // would be held until the visitor cleared it by hand, which is the worst
  // failure this file can cause.
  assert.throws(
    () => precacheList({ pages: map({ '/big': {} }), assets: map({}) }),
    /\/big has no ETag/,
  );
});

test('the order is the URL, so two builds of one site agree', () => {
  const list = precacheList({
    pages: map({ '/z': { etag: '"1"' }, '/a': { etag: '"2"' } }),
    assets: map({ '/assets/m.css': { etag: '"3"' } }),
  });

  assert.deepEqual(list.map((e) => e.url), ['/a', '/assets/m.css', '/z']);
});

test('the document is the format Workbox already reads', () => {
  const body = precacheDocument([{ url: '/', revision: '"a"' }], 'v1');
  const parsed = JSON.parse(body);

  assert.equal(parsed.version, 'v1');
  assert.deepEqual(parsed.precache, [{ url: '/', revision: '"a"' }]);
  assert.match(body, /\n$/, 'no trailing newline');
});

test('the path is one word, and it is what the build writes under static/', () => {
  assert.equal(PRECACHE_PATH, '/precache.json');
});

// ---- through the real app --------------------------------------------------

const { createApp } = await import('../src/app.js');
const bytes = (t) => new TextEncoder().encode(t);

const appWith = (precache) =>
  createApp({
    config: { csrf: false, trailingSlash: 'never', cookieSecret: 's' },
    manifest: { routes: [], endpoints: [] },
    pages: {},
    statics: { get: () => null },
    assets: { get: () => null },
    notFound: { body: bytes('nope'), etag: '"n"', encodings: new Map(), type: 'text/html' },
    errorPage: { body: bytes('broke'), etag: '"e"', encodings: new Map(), type: 'text/html' },
    hash: (b) => `"${b.length.toString(36)}"`,
    compress: null,
    precache,
  });

test('the server answers with what the build wrote, as JSON', async () => {
  const body = precacheDocument([{ url: '/', revision: '"a"' }], 'v1');
  const res = await appWith(body).request(`http://x${PRECACHE_PATH}`);

  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/json/);
  assert.equal(await res.text(), body);
});

test('it is not cached, since it says what version everything else is', async () => {
  const res = await appWith(precacheDocument([], 'v1')).request(`http://x${PRECACHE_PATH}`);
  assert.match(res.headers.get('cache-control'), /no-cache/);
});

test('no build wrote one, so there is no route', async () => {
  const res = await appWith(null).request(`http://x${PRECACHE_PATH}`);
  assert.equal(res.status, 404);
});
