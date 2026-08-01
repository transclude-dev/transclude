// Including a region of another route of this app.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.js';

const bytes = (t) => new TextEncoder().encode(t);

/** A page module, with whatever the test needs on it. */
const page = (over = {}) => ({
  layouts: [],
  css: '',
  headScript: '',
  hasTitle: false,
  renderTitle: () => '',
  renderHead: () => '',
  renderHtmlAttrs: () => ({}),
  elements: [],
  regions: {},
  includes: [],
  load: async () => ({}),
  render: () => ({ default: '' }),
  ...over,
});

function appWith(routes, pages, config = {}) {
  return createApp({
    config: { csrf: false, trailingSlash: 'never', cookieSecret: 's', ...config },
    manifest: { routes, endpoints: [] },
    pages,
    statics: { get: () => null },
    assets: { get: () => null },
    notFound: { body: bytes('nope'), etag: '"n"', encodings: new Map(), type: 'text/html' },
    errorPage: { body: bytes('broke'), etag: '"e"', encodings: new Map(), type: 'text/html' },
    hash: (b) => `"${b.length.toString(36)}"`,
    compress: null,
  });
}

const ROUTES = [
  { id: 'index', pattern: '/', params: [], client: null },
  { id: 'docs', pattern: '/docs/install', params: [], client: null },
];

test('a page renders a region of another route into itself', async () => {
  const app = appWith(ROUTES, {
    index: page({
      includes: [{ key: '/docs/install#setup', kind: 'route', where: '/docs/install', id: 'setup' }],
      render: (d) => ({ default: `<main>${d.__included['/docs/install#setup']}</main>` }),
    }),
    docs: page({ regions: { setup: () => '<h2 id="setup">Setup</h2>' } }),
  });

  const html = await (await app.request('http://x/')).text();
  assert.match(html, /<main><h2 id="setup">Setup<\/h2><\/main>/);
});

test('the included route sees its own params', async () => {
  const app = appWith(
    [
      { id: 'index', pattern: '/', params: [], client: null },
      { id: 'person', pattern: '/people/:name', params: ['name'], client: null },
    ],
    {
      index: page({
        includes: [{ key: '/people/ada#card', kind: 'route', where: '/people/ada', id: 'card' }],
        render: (d) => ({ default: d.__included['/people/ada#card'] }),
      }),
      person: page({
        load: async (ctx) => ({ who: ctx.params.name }),
        regions: { card: (d) => `<p>${d.who}</p>` },
      }),
    },
  );

  assert.match(await (await app.request('http://x/')).text(), /<p>ada<\/p>/);
});

test('one route included twice runs its loaders once', async () => {
  // Ten includes of one route should be one render, and the memo must not
  // outlive the request.
  let loads = 0;
  const app = appWith(ROUTES, {
    index: page({
      includes: [
        { key: '/docs/install#a', kind: 'route', where: '/docs/install', id: 'a' },
        { key: '/docs/install#a2', kind: 'route', where: '/docs/install', id: 'a' },
      ],
      render: (d) => ({ default: `${d.__included['/docs/install#a']}${d.__included['/docs/install#a2']}` }),
    }),
    docs: page({ load: async () => (loads += 1, {}), regions: { a: () => '<p>x</p>' } }),
  });

  await app.request('http://x/');
  assert.equal(loads, 1, 'the route was rendered twice for one request');

  await app.request('http://x/');
  assert.equal(loads, 2, 'the memo outlived the request');
});

test('a page that includes a route reading a cookie is not cached', async () => {
  // The leak. Without the shared cookies the host looks shareable, and the
  // second visitor is handed the first one's page.
  let renders = 0;
  const app = appWith(ROUTES, {
    index: page({
      revalidate: 60,
      includes: [{ key: '/docs/install#a', kind: 'route', where: '/docs/install', id: 'a' }],
      render: (d) => ({ default: d.__included['/docs/install#a'] }),
    }),
    docs: page({
      load: async (ctx) => (renders += 1, { seat: ctx.cookies.get('seat') ?? 'none' }),
      regions: { a: (d) => `<p>${d.seat}</p>` },
    }),
  });

  const first = await (await app.request('http://x/', { headers: { cookie: 'seat=A1' } })).text();
  const second = await (await app.request('http://x/', { headers: { cookie: 'seat=B2' } })).text();

  assert.match(first, /A1/);
  assert.match(second, /B2/, 'the second visitor was handed the first one\'s page');
  assert.equal(renders, 2);
});

test('a page including a route that reads nothing is still cached', async () => {
  let renders = 0;
  const app = appWith(ROUTES, {
    index: page({
      revalidate: 60,
      includes: [{ key: '/docs/install#a', kind: 'route', where: '/docs/install', id: 'a' }],
      render: (d) => ({ default: d.__included['/docs/install#a'] }),
    }),
    docs: page({ load: async () => (renders += 1, {}), regions: { a: () => '<p>x</p>' } }),
  });

  await app.request('http://x/');
  await app.request('http://x/');
  assert.equal(renders, 1, 'a shared page was rendered twice');
});

test('a page including itself is refused, with the way round', async () => {
  const app = appWith(ROUTES, {
    index: page({
      includes: [{ key: '/#loop', kind: 'route', where: '/', id: 'loop' }],
      regions: { loop: (d) => `<p>${d.__included?.['/#loop'] ?? ''}</p>` },
      render: () => ({ default: 'x' }),
    }),
    docs: page(),
  });

  const response = await app.request('http://x/');
  assert.equal(response.status, 500);
});

test('a route nobody serves leaves null, so the element falls back', async () => {
  const app = appWith(ROUTES, {
    index: page({
      includes: [{ key: '/nope#a', kind: 'route', where: '/nope', id: 'a' }],
      render: (d) => ({ default: `<main>${d.__included['/nope#a'] ?? 'fallback'}</main>` }),
    }),
    docs: page(),
  });

  assert.match(await (await app.request('http://x/')).text(), /fallback/);
});

test('a region the other route does not have leaves null', async () => {
  const app = appWith(ROUTES, {
    index: page({
      includes: [{ key: '/docs/install#nope', kind: 'route', where: '/docs/install', id: 'nope' }],
      render: (d) => ({ default: `<main>${d.__included['/docs/install#nope'] ?? 'fallback'}</main>` }),
    }),
    docs: page({ regions: { setup: () => 'x' } }),
  });

  assert.match(await (await app.request('http://x/')).text(), /fallback/);
});

// ---- the loop guard, where the message is visible ---------------------------

import { INCLUDE_DEPTH, resolveIncludes } from '../src/document.js';

const ctx = { url: 'http://x/' };

test('a loop is named, not just refused', async () => {
  const options = {
    includeChain: ['/a#one'],
    include: { route: async () => 'never' },
  };

  await assert.rejects(
    () => resolveIncludes([{ key: '/a#one', kind: 'route', where: '/a', id: 'one' }], ctx, options),
    /includes itself: \/a#one includes \/a#one/,
  );
});

test('a longer way round is named in order', async () => {
  const options = {
    includeChain: ['/a#x', '/b#y'],
    include: { route: async () => 'never' },
  };

  await assert.rejects(
    () => resolveIncludes([{ key: '/a#x', kind: 'route', where: '/a', id: 'x' }], ctx, options),
    /\/a#x includes \/b#y includes \/a#x/,
  );
});

test('a chain that never repeats still stops at the depth limit', async () => {
  // Ten pages each including the next is not a loop, and would still render
  // until something gave out.
  const options = {
    includeChain: Array.from({ length: INCLUDE_DEPTH }, (_, i) => `/p${i}#a`),
    include: { route: async () => 'never' },
  };

  await assert.rejects(
    () => resolveIncludes([{ key: '/deep#a', kind: 'route', where: '/deep', id: 'a' }], ctx, options),
    new RegExp(`past the limit of ${INCLUDE_DEPTH}`),
  );
});

test('a misconfiguration is thrown, and an unreachable source is not', async () => {
  // The distinction the fallback rests on. A source that is down is what the
  // children are for; a source nobody allowed is a mistake and should be heard.
  const down = await resolveIncludes(
    [{ key: '/a#x', kind: 'route', where: '/a', id: 'x' }],
    ctx,
    { include: { route: async () => { throw new Error('the route blew up'); } } },
  );
  assert.deepEqual(down, { '/a#x': null });

  await assert.rejects(
    () => resolveIncludes([{ key: '/a#x', kind: 'route', where: '/a', id: 'x' }], ctx, {}),
    /no way to reach one/,
  );
});
