// `workerFrom`: the wiring nine apps used to write out by hand.
//
// The properties tested here used to be tested in `examples/showcase`, against
// the copy of this code that lived in its `worker.js`. The code moved into the
// package, so the assertions moved with it. What the example still checks is
// that its entry reaches the package by name and points wrangler at the file.

import test from 'node:test';
import assert from 'node:assert/strict';

import { workerFrom } from '../src/worker.js';

const page = {
  layouts: [],
  css: '',
  headScript: '',
  hasTitle: false,
  renderTitle: () => '',
  renderHead: () => '',
  elements: [],
  regions: { list: () => '' },
  load: async () => ({}),
  render: () => ({ default: '<p>ok</p>' }),
};

const entry = { pages: { index: page }, endpoints: {}, middleware: null };

/** What `dist/server/assets.js` exports, with nothing in it. */
const bundle = {
  statics: {},
  assets: {},
  publicFiles: {},
  notFound: null,
  errorPage: null,
  precache: null,
};

const manifest = {
  routes: [{ id: 'index', pattern: '/', params: [], client: null }],
  dynamic: [],
  endpoints: [],
};

const config = { csrf: false, trailingSlash: 'never', fragmentParam: 'fragment' };

const workerOf = (over = {}) => workerFrom({ config, manifest, entry, bundle, ...over });

// ---- when the app is built -------------------------------------------------

test('the app is built on the first request, and only once', async () => {
  // `env` exists at request time and not before. Building at import is what read
  // a secret as undefined while the variable was set, and signing then refused.
  // `statics` is read inside `createApp`, so counting it counts the builds.
  let builds = 0;
  const counted = new Proxy(bundle, {
    get(target, key) {
      if (key === 'statics') builds += 1;
      return target[key];
    },
  });

  const worker = workerFrom({ config, manifest, entry, bundle: counted });
  assert.equal(builds, 0, 'it built the app before any request, where there is no env');

  await worker.fetch(new Request('http://x/'), {}, undefined);
  assert.equal(builds, 1);

  await worker.fetch(new Request('http://x/'), {}, undefined);
  assert.equal(builds, 1, 'it rebuilt the app for the second request');
});

// ---- the one piece of config that arrives with the request -----------------

// A page that signs a cookie, which is the one thing that refuses without a
// secret. Asserting a 200 on a page that never signs anything would pass with
// the env wiring deleted, which is what the first version of these did.
const signing = {
  ...page,
  load: async (ctx) => (await ctx.cookies.signed.set('session', 'abc'), {}),
};

const signingWorker = (over) =>
  workerFrom({ config, manifest, entry: { ...entry, pages: { index: signing } }, bundle, ...over });

test('cookieSecret comes from env, because that is where a worker keeps it', async () => {
  const out = await signingWorker().fetch(new Request('http://x/'), { COOKIE_SECRET: 'from-env' }, undefined);
  assert.equal(out.status, 200);
});

test('without a secret anywhere, signing refuses', async () => {
  // The other half. Without this, the test above passes on a build that ignores
  // `env` completely, because nothing would have needed the secret.
  const out = await signingWorker().fetch(new Request('http://x/'), {}, undefined);
  assert.equal(out.status, 500);
});

test('a config secret is used when env has none', async () => {
  const worker = signingWorker({ config: { ...config, cookieSecret: 'from-config' } });
  const out = await worker.fetch(new Request('http://x/'), {}, undefined);

  assert.equal(out.status, 200);
});

// ---- the manifest ----------------------------------------------------------

test('a manifest that arrives as text is parsed', async () => {
  // There is no JSON module type in Workers, so it usually arrives as a string.
  // Used as an object it gives a route table of `undefined` and a site of 404s
  // that looks exactly like a routing bug.
  const worker = workerOf({ manifest: JSON.stringify(manifest) });
  const out = await worker.fetch(new Request('http://x/'), {}, undefined);

  assert.equal(out.status, 200);
  assert.match(await out.text(), /<p>ok<\/p>/);
});

test('a manifest that is already an object is left alone', async () => {
  const out = await workerOf().fetch(new Request('http://x/'), {}, undefined);
  assert.equal(out.status, 200);
});

// ---- what the runtime hands over -------------------------------------------

test('the ExecutionContext is passed through, so ctx.after can reach it', async () => {
  // Dropping the third argument would leave `ctx.after` working everywhere it is
  // not needed and doing nothing on the one runtime that needs it.
  const held = [];
  const after = { ...page, load: async (ctx) => (ctx.after(Promise.resolve()), {}) };

  const worker = workerFrom({
    config,
    manifest,
    entry: { ...entry, pages: { index: after } },
    bundle,
  });

  await worker.fetch(new Request('http://x/'), {}, {
    waitUntil: (work) => held.push(work),
    passThroughOnException() {},
  });

  assert.equal(held.length, 1, 'the ExecutionContext never reached the app');
});

// ---- a bundle without files -------------------------------------------------

test('a bundle with pages only serves its pages', async () => {
  // What `dist/server/pages.js` exports. The edge serves the public files and
  // the hashed assets before the worker runs, so the bundle carries neither.
  const pagesOnly = { statics: {}, notFound: null, errorPage: null, precache: null };
  const worker = workerOf({ bundle: pagesOnly });

  const page = await worker.fetch(new Request('http://x/'), {}, undefined);
  assert.equal(page.status, 200);

  // A file request that reaches the worker is one the edge did not have.
  const file = await worker.fetch(new Request('http://x/robots.txt'), {}, undefined);
  assert.equal(file.status, 404);
});

// ---- public files ------------------------------------------------------------

// Ten bytes, so each range below can be checked by eye.
const counted = {
  '/count.txt': {
    type: 'text/plain; charset=utf-8',
    etag: 'W/"a-1"',
    lastModified: 'Wed, 18 Nov 2026 10:00:00 GMT',
    body: btoa('0123456789'),
  },
};

const fileFrom = (headers = {}, method = 'GET') =>
  workerOf({ bundle: { ...bundle, publicFiles: counted } }).fetch(
    new Request('http://x/count.txt', { method, headers }),
    {},
    undefined,
  );

test('a public file carries what Node sends for it: validator, date and caching', async () => {
  const res = await fileFrom();
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '0123456789');
  assert.equal(res.headers.get('etag'), 'W/"a-1"');
  assert.equal(res.headers.get('last-modified'), 'Wed, 18 Nov 2026 10:00:00 GMT');
  assert.equal(res.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
});

test('a matching If-None-Match is a 304', async () => {
  const res = await fileFrom({ 'if-none-match': 'W/"a-1"' });
  assert.equal(res.status, 304);
});

test('a range is a 206 with the slice, bounded, open-ended or from the end', async () => {
  for (const [range, body, contentRange] of [
    ['bytes=2-5', '2345', 'bytes 2-5/10'],
    ['bytes=7-', '789', 'bytes 7-9/10'],
    ['bytes=-3', '789', 'bytes 7-9/10'],
    ['bytes=8-99', '89', 'bytes 8-9/10'],
  ]) {
    const res = await fileFrom({ range });
    assert.equal(res.status, 206, range);
    assert.equal(await res.text(), body, range);
    assert.equal(res.headers.get('content-range'), contentRange, range);
    assert.equal(res.headers.get('accept-ranges'), 'bytes', range);
  }
});

test('a range outside the file is a 416 naming the size', async () => {
  const res = await fileFrom({ range: 'bytes=10-' });
  assert.equal(res.status, 416);
  assert.equal(res.headers.get('content-range'), 'bytes */10');
});

test('a HEAD gets the headers and no body', async () => {
  const res = await fileFrom({}, 'HEAD');
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '');
  assert.equal(res.headers.get('etag'), 'W/"a-1"');
});
