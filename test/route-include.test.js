// Including a region of another route of this app.

import test from 'node:test';
import assert from 'node:assert/strict';

import nodeFs from 'node:fs';
import * as nodeUrl from 'node:url';

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

test('a region the other route does not have is refused, before its loaders run', async () => {
  // A route's fragments are fixed when it compiles, so the name is a typo. It
  // used to fall back, after running the route's loaders for nothing, and a
  // loader that read a cookie made the page private as it did.
  let loads = 0;
  const seen = [];
  const app = appWith(
    ROUTES,
    {
      index: page({
        includes: [{ key: '/docs/install#nope', kind: 'route', where: '/docs/install', id: 'nope' }],
        render: (d) => ({ default: `<main>${d.__included['/docs/install#nope'] ?? 'fallback'}</main>` }),
      }),
      docs: page({
        regions: { setup: () => 'x' },
        load: async () => {
          loads++;
          return {};
        },
      }),
    },
    { onError: (err) => seen.push(err.message) },
  );

  const response = await app.request('http://x/');
  assert.equal(response.status, 500);
  assert.equal(loads, 0);
  assert.deepEqual(seen, [
    '[transclude] <transclude src="/docs/install#nope"> names no fragment of /docs/install. ' +
      'A fragment is an element with an id and a "fragment" attribute.',
  ]);
});

test('a path with a slash at the end reaches the route a request for it would', async () => {
  const app = appWith(ROUTES, {
    index: page({
      includes: [{ key: '/docs/install/#setup', kind: 'route', where: '/docs/install/', id: 'setup' }],
      render: (d) => ({ default: `<main>${d.__included['/docs/install/#setup'] ?? 'fallback'}</main>` }),
    }),
    docs: page({ regions: { setup: () => '<h2 id="setup">Setup</h2>' } }),
  });

  assert.match(await (await app.request('http://x/')).text(), /<main><h2 id="setup">Setup<\/h2><\/main>/);
});

// ---- a loop of loads, which used to wait forever -----------------------------
//
// Loading a route resolves every include on it, and the memo shares one load
// per route. A loop that comes back by another fragment found its own promise
// in the memo, and the request never answered. `spec/DRILLS.md` has the drill.

const YZ = [
  { id: 'index', pattern: '/', params: [], client: null },
  { id: 'y', pattern: '/y', params: [], client: null },
  { id: 'z', pattern: '/z', params: [], client: null },
];

const include = (key) => {
  const [where, id] = key.split('#');
  return { key, kind: 'route', where, id };
};

/** The status, or `waited` when the request has not answered in two seconds. */
async function statusOf(app) {
  let timer;
  const waited = new Promise((resolve) => {
    timer = setTimeout(() => resolve('waited'), 2000);
  });
  const answered = app.request('http://x/').then((response) => response.status);
  const status = await Promise.race([answered, waited]);
  clearTimeout(timer);
  return status;
}

test('a loop that comes back by another fragment is refused, and named', async () => {
  const seen = [];
  const app = appWith(
    YZ,
    {
      index: page({ includes: [include('/y#a')] }),
      y: page({ includes: [include('/z#c')], regions: { a: () => 'A', d: () => 'D' } }),
      z: page({ includes: [include('/y#d')], regions: { c: () => 'C' } }),
    },
    { onError: (err) => seen.push(err.message) },
  );

  assert.equal(await statusOf(app), 500);
  assert.deepEqual(seen, ['[transclude] <transclude> includes itself: /y includes /z includes /y.']);
});

test('a loop entered from both ends at once is refused too', async () => {
  // Neither chain repeats here: the page starts `/y` and `/z` together, and
  // each finds the other's load in the memo.
  const seen = [];
  const app = appWith(
    YZ,
    {
      index: page({ includes: [include('/y#a'), include('/z#c')] }),
      y: page({ includes: [include('/z#e')], regions: { a: () => 'A', d: () => 'D' } }),
      z: page({ includes: [include('/y#d')], regions: { c: () => 'C', e: () => 'E' } }),
    },
    { onError: (err) => seen.push(err.message) },
  );

  assert.equal(await statusOf(app), 500);
  assert.equal(seen.length, 1);
  assert.match(seen[0], /includes itself: \/[yz] includes \/[yz] includes \/[yz]\./);
});

test('two routes that include the same third one are no loop', async () => {
  const app = appWith(
    [...YZ, { id: 'w', pattern: '/w', params: [], client: null }],
    {
      index: page({
        includes: [include('/y#a'), include('/z#c')],
        render: (d) => ({ default: `<main>${d.__included['/y#a']}${d.__included['/z#c']}</main>` }),
      }),
      y: page({ includes: [include('/w#x')], regions: { a: () => 'A' } }),
      z: page({ includes: [include('/w#x')], regions: { c: () => 'C' } }),
      w: page({ regions: { x: () => 'X' } }),
    },
  );

  assert.equal(await statusOf(app), 200);
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

// ---- the three servers agree ------------------------------------------------

test('every server that renders a page builds the same include context', () => {
  // The bug this closes. The dev server was given a resolver that could reach
  // another site but not another route, so `<transclude src="/x#y">`
  // worked in production and threw in dev. Nothing but running dev showed it,
  // and the build had the same gap waiting.
  const files = ['../src/app.js', '../bin/dev.js', '../bin/build.js'];

  for (const file of files) {
    const source = codeOf(new URL(file, import.meta.url));
    assert.match(source, /includeContext\(/, `${file} builds its own include context`);
    assert.doesNotMatch(
      source,
      /includeResolver\(/,
      `${file} still builds half of one, which is how they came apart`,
    );
  }
});

test('the context reaches both kinds, or says which it cannot', async () => {
  const { includeContext } = await import('../src/include.js');

  const withProxy = includeContext({
    config: { proxy: { allow: ['x.example'] } },
    routes: [],
    pageFor: () => null,
  });
  assert.equal(typeof withProxy.resolve, 'function');
  assert.equal(typeof withProxy.route, 'function');

  // No allowed host is not the same as no route resolver: reading another route
  // needs no configuration, because nothing leaves the server.
  const without = includeContext({ config: {}, routes: [], pageFor: () => null });
  assert.equal(without.resolve, null);
  assert.equal(typeof without.route, 'function');
});

test('an empty allow is no proxy, so the error names the fix', async () => {
  // A resolver built with no hosts refused every one as "not an allowed host",
  // which is true and sends the reader to the wrong line.
  const { includeContext } = await import('../src/include.js');
  const empty = includeContext({ config: { proxy: { allow: [] } }, routes: [], pageFor: () => null });
  assert.equal(empty.resolve, null);

  await assert.rejects(
    () =>
      resolveIncludes([{ key: 'https://x.example/a#b', kind: 'external', where: 'https://x.example/a', id: 'b' }], ctx, {
        include: empty,
      }),
    /no host is allowed to be read\. Name one in `proxy\.allow`/,
  );
});

function codeOf(url) {
  const source = nodeFs.readFileSync(nodeUrl.fileURLToPath(url), 'utf8');
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}
