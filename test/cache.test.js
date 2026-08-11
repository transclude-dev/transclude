// Revalidation: a rendered page held for a while, refreshed without a build.

import test from 'node:test';
import assert from 'node:assert/strict';

import { cacheKey, createCache, memoryStore, windowOf } from '../src/cache.js';

/** A clock the test moves, so nothing here waits on real seconds. */
function clock(start = 0) {
  let value = start;
  return { now: () => value, tick: (ms) => (value += ms) };
}

const ok = (html) => async () => ({ html, cacheable: true });

// ---- what a page asked for ------------------------------------------------

test('a number is seconds, and an object carries tags', () => {
  assert.deepEqual(windowOf({ revalidate: 60 }), { seconds: 60, tags: [] });
  assert.deepEqual(windowOf({ revalidate: { seconds: 60, tags: ['plans'] } }), {
    seconds: 60,
    tags: ['plans'],
  });
});

test('no revalidate is no window, which is every route today', () => {
  assert.equal(windowOf({}), null);
  assert.equal(windowOf({ revalidate: false }), null);
  assert.equal(windowOf(undefined), null);
});

test('something that is not a number of seconds is refused', () => {
  // `revalidate: '1h'` would otherwise cache forever or not at all, silently.
  assert.throws(() => windowOf({ revalidate: '1h' }), /number of seconds/);
  assert.throws(() => windowOf({ revalidate: -1 }), /number of seconds/);
});

// ---- serving from the store -----------------------------------------------

test('within the window the render does not run again', async () => {
  const time = clock();
  const cache = createCache(memoryStore(), time);
  let renders = 0;
  const render = async () => (renders++, { html: `v${renders}`, cacheable: true });

  assert.equal(await cache.read('/x', { seconds: 60, tags: [] }, render), 'v1');
  time.tick(59_000);
  assert.equal(await cache.read('/x', { seconds: 60, tags: [] }, render), 'v1');
  assert.equal(renders, 1);
});

test('past the window the stale page goes out and a fresh one is built behind it', async () => {
  // The point of the whole thing: the cost of being out of date is bounded and
  // no visitor pays it.
  const time = clock();
  const cache = createCache(memoryStore(), time);
  let renders = 0;
  const render = async () => (renders++, { html: `v${renders}`, cacheable: true });
  const window = { seconds: 60, tags: [] };

  await cache.read('/x', window, render);
  time.tick(61_000);

  assert.equal(await cache.read('/x', window, render), 'v1', 'the visitor waited for a render');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(await cache.read('/x', window, render), 'v2', 'it never refreshed');
});

test('one render at a time per key, however many requests arrive', async () => {
  // Without this the first request past the window and every one behind it each
  // start their own.
  const time = clock();
  const cache = createCache(memoryStore(), time);
  let renders = 0;
  const render = async () => {
    renders++;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { html: 'v', cacheable: true };
  };
  const window = { seconds: 60, tags: [] };

  await Promise.all([
    cache.read('/x', window, render),
    cache.read('/x', window, render),
    cache.read('/x', window, render),
  ]);

  assert.equal(renders, 1);
});

// ---- the rebuild has to be held --------------------------------------------
//
// Node, Bun and Deno are processes: a promise nobody awaits finishes anyway.
// workerd is not. The isolate may stop when the response is sent, and it stops
// the rebuild with it, so the `finally` that frees the key never runs. The next
// request for that key then waits on a promise that is already dead, and the
// page hangs for as long as the isolate lives. Found on a deployed site.

test('the stale rebuild is handed to after, which is what keeps it alive', async () => {
  const time = clock();
  const cache = createCache(memoryStore(), time);
  const held = [];
  const after = (work) => held.push(work);
  const window = { seconds: 60, tags: [] };

  await cache.read('/x', window, ok('v1'), after);
  assert.deepEqual(held, [], 'a first render is awaited by the request itself');

  time.tick(61_000);
  await cache.read('/x', window, ok('v2'), after);

  assert.equal(held.length, 1, 'the rebuild behind the response was not held');
  assert.equal(typeof held[0].then, 'function', 'after takes a promise, not a function');
});

test('a rebuild nobody holds still cannot reject into the runtime', async () => {
  // The old behaviour, kept for a caller that passes no `after`.
  const time = clock();
  const cache = createCache(memoryStore(), time);
  const window = { seconds: 60, tags: [] };
  const failing = async () => {
    throw new Error('the loader threw');
  };

  await cache.read('/x', window, ok('v1'));
  time.tick(61_000);

  assert.equal(await cache.read('/x', window, failing), 'v1', 'the stale copy still went out');
  await new Promise((resolve) => setTimeout(resolve, 5));
});

test('a rebuild that never settles does not hang the next request', async () => {
  // The reported failure, as a test. The first rebuild is a promise that never
  // settles, which is what workerd leaves behind when it stops the work.
  const time = clock();
  const cache = createCache(memoryStore(), time);
  const window = { seconds: 60, tags: [] };
  let renders = 0;

  const render = async () => {
    renders++;
    if (renders === 2) await new Promise(() => {});
    return { html: `v${renders}`, cacheable: true };
  };

  await cache.read('/x', window, render);
  time.tick(61_000);

  // Serves the stale copy and abandons a rebuild that will never come back.
  assert.equal(await cache.read('/x', window, render), 'v1');

  // A save drops the entry, so the next request has nothing to serve and has to
  // wait for a render. Without the bound it waits on the dead one, forever.
  cache.revalidatePath('/x');
  time.tick(30_000);

  const answer = await Promise.race([
    cache.read('/x', window, render),
    new Promise((resolve) => setTimeout(() => resolve('HUNG'), 50)),
  ]);

  assert.notEqual(answer, 'HUNG', 'the request waited on a promise that was already dead');
  assert.equal(answer, 'v3');
});

test('inside the bound the key is still shared, so one render serves all', async () => {
  // The other half. A bound that let every request start its own render would
  // pass the test above and lose the reason the map exists.
  const time = clock();
  const cache = createCache(memoryStore(), time);
  const window = { seconds: 60, tags: [] };
  let renders = 0;
  const render = async () => {
    renders++;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { html: 'v', cacheable: true };
  };

  cache.read('/x', window, render);
  time.tick(29_000);
  await cache.read('/x', window, render);

  assert.equal(renders, 1);
});

test('a render that finishes after it was replaced leaves the replacement alone', async () => {
  // Two entries for one key existed in sequence. The slow one's `finally` must
  // not delete the fast one, or the key is free while a render is running.
  const time = clock();
  const cache = createCache(memoryStore(), time);
  const window = { seconds: 60, tags: [] };
  let release;
  let renders = 0;

  const render = async () => {
    renders++;
    if (renders === 1) await new Promise((resolve) => (release = resolve));
    return { html: `v${renders}`, cacheable: true };
  };

  cache.read('/x', window, render);
  time.tick(31_000);
  cache.read('/x', window, render);

  // The first one comes back late, after the second took the key.
  release();
  await new Promise((resolve) => setTimeout(resolve, 5));

  await cache.read('/x', window, render);
  assert.equal(renders, 2, 'the late finally freed a key the replacement was using');
});

test('a route with no window always renders', async () => {
  const cache = createCache();
  assert.equal(await cache.read('/x', null, ok('fresh')), null);
});

// ---- what is not cached ---------------------------------------------------

test('a page that is not cacheable is served and not stored', async () => {
  const time = clock();
  const cache = createCache(memoryStore(), time);
  let renders = 0;
  const render = async () => (renders++, { html: `v${renders}`, cacheable: false });
  const window = { seconds: 60, tags: [] };

  assert.equal(await cache.read('/x', window, render), 'v1');
  assert.equal(await cache.read('/x', window, render), 'v2', 'it was stored anyway');
});

test('a page that stops being cacheable drops the copy it had', async () => {
  // Holding the last good one would keep serving a page the app has decided not
  // to give out, which is the shape of a session leak.
  const time = clock();
  const store = memoryStore();
  const cache = createCache(store, time);
  const window = { seconds: 60, tags: [] };

  await cache.read('/x', window, ok('public'));
  assert.ok(store.get('/x'));

  time.tick(61_000);
  await cache.read('/x', window, async () => ({ html: 'private', cacheable: false }));
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(store.get('/x'), undefined);
});

// ---- invalidation ---------------------------------------------------------

test('a tag drops every entry carrying it, and leaves the rest', async () => {
  const time = clock();
  const store = memoryStore();
  const cache = createCache(store, time);

  await cache.read('/a', { seconds: 60, tags: ['plans'] }, ok('a'));
  await cache.read('/b', { seconds: 60, tags: ['plans'] }, ok('b'));
  await cache.read('/c', { seconds: 60, tags: ['other'] }, ok('c'));

  cache.revalidateTag('plans');

  assert.equal(store.get('/a'), undefined);
  assert.equal(store.get('/b'), undefined);
  assert.ok(store.get('/c'));
});

test('a path can be dropped on its own', async () => {
  const store = memoryStore();
  const cache = createCache(store, clock());

  await cache.read('/a', { seconds: 60, tags: [] }, ok('a'));
  cache.revalidatePath('/a');
  assert.equal(store.get('/a'), undefined);
});

// ---- the default store ----------------------------------------------------

test('the key carries the query, because ?q= renders differently', () => {
  assert.equal(cacheKey('http://x/search?q=ada'), '/search?q=ada');
  assert.notEqual(cacheKey('http://x/search?q=a'), cacheKey('http://x/search?q=b'));
});

test('the store is bounded, since the key carries the query', async () => {
  // A route reading `?q=` has as many entries as there are searches.
  const store = memoryStore({ max: 2 });
  store.set('a', { html: 'a', tags: [] });
  store.set('b', { html: 'b', tags: [] });
  store.set('c', { html: 'c', tags: [] });

  assert.equal(store.get('a'), undefined, 'the oldest should have gone');
  assert.ok(store.get('c'));
});

test('rewriting an entry moves it back, so a busy page is not evicted', async () => {
  const store = memoryStore({ max: 2 });
  store.set('a', { html: 'a', tags: [] });
  store.set('b', { html: 'b', tags: [] });
  store.set('a', { html: 'a2', tags: [] });
  store.set('c', { html: 'c', tags: [] });

  assert.ok(store.get('a'), 'the rewritten entry was evicted');
  assert.equal(store.get('b'), undefined);
});

test('a store can be swapped for one that is shared', async () => {
  // The seam that makes this work on more than one instance.
  const calls = [];
  const store = {
    get: (k) => (calls.push(['get', k]), undefined),
    set: (k) => calls.push(['set', k]),
    delete: (k) => calls.push(['delete', k]),
    deleteByTag: (t) => calls.push(['deleteByTag', t]),
  };

  const cache = createCache(store, clock());
  await cache.read('/x', { seconds: 60, tags: [] }, ok('x'));
  cache.revalidateTag('t');

  assert.deepEqual(calls, [['get', '/x'], ['set', '/x'], ['deleteByTag', 't']]);
});

// ---- what makes a page personal -------------------------------------------

test('reading a cookie marks the request, so the page is not shared', async () => {
  // The leak this closes: `/notes` renders "you have added N of these" from a
  // cookie and writes no header at all. Checking only what was written would
  // have cached it, and the next visitor would have got the first one's count.
  const { cookiesOf } = await import('../src/cookies.js');
  const response = { status: 200, headers: new Headers() };
  const request = new Request('http://x/', { headers: { cookie: 'mine=3' } });

  const cookies = cookiesOf(request, response, 's');
  assert.equal(cookies.personal, false, 'nothing has been read yet');

  cookies.get('mine');
  assert.equal(cookies.personal, true);
});

test('a request that never asks about cookies stays shareable', async () => {
  const { cookiesOf } = await import('../src/cookies.js');
  const cookies = cookiesOf(new Request('http://x/'), { status: 200, headers: new Headers() }, 's');

  assert.equal(cookies.personal, false);
});

test('all() counts as reading, and so does a signed get', async () => {
  const { cookiesOf } = await import('../src/cookies.js');
  const make = () => cookiesOf(new Request('http://x/'), { status: 200, headers: new Headers() }, 's');

  const viaAll = make();
  viaAll.all();
  assert.equal(viaAll.personal, true);

  const viaSigned = make();
  await viaSigned.signed.get('session');
  assert.equal(viaSigned.personal, true);
});

// ---- through the real app -------------------------------------------------

const { createApp } = await import('../src/app.js');

const bytes = (text) => new TextEncoder().encode(text);

/** A page whose body changes each render, so a cache hit is visible. */
function appWith(load, revalidate = 60) {
  let renders = 0;

  const app = createApp({
    config: { csrf: false, trailingSlash: 'never', fragmentParam: 'fragment', cookieSecret: 's' },
    manifest: { routes: [{ id: 'index', pattern: '/', params: [], client: null }], endpoints: [] },
    pages: {
      index: {
        revalidate,
        layouts: [],
        css: '',
        headScript: '',
        hasTitle: false,
        renderTitle: () => '',
        renderHead: () => '',
        elements: [],
        regions: {},
        load: async (ctx) => (renders++, load ? load(ctx) : {}),
        render: () => ({ default: `<p>render ${renders}</p>` }),
      },
    },
    statics: { get: () => null },
    assets: { get: () => null },
    notFound: { body: bytes('nope'), etag: '"n"', encodings: new Map(), type: 'text/html' },
    errorPage: { body: bytes('broke'), etag: '"e"', encodings: new Map(), type: 'text/html' },
    hash: (body) => `"${body.length.toString(36)}"`,
    compress: null,
  });

  return { app, renders: () => renders };
}

test('a shared page is rendered once and served twice', async () => {
  const { app, renders } = appWith(null);

  await app.request('http://x/');
  await app.request('http://x/');

  assert.equal(renders(), 1);
});

test('a page that reads a cookie is rendered every time', async () => {
  // The leak this closes. Without it the second visitor is handed the first
  // one's page, count and all, and nothing anywhere says so.
  const { app, renders } = appWith((ctx) => ({ mine: ctx.cookies.get('mine') ?? '0' }));

  await app.request('http://x/', { headers: { cookie: 'mine=1' } });
  await app.request('http://x/', { headers: { cookie: 'mine=2' } });

  assert.equal(renders(), 2, "one visitor's page was served to the next");
});

test('a page that sets a cookie is rendered every time', async () => {
  const { app, renders } = appWith((ctx) => {
    ctx.cookies.set('seen', '1');
    return {};
  });

  await app.request('http://x/');
  await app.request('http://x/');

  assert.equal(renders(), 2);
});

test('a route with no revalidate is never held', async () => {
  // `undefined` here would take the default parameter and ask for 60 seconds.
  const { app, renders } = appWith(null, null);

  await app.request('http://x/');
  await app.request('http://x/');

  assert.equal(renders(), 2);
});

test('a different query is a different page', async () => {
  const { app, renders } = appWith(null);

  await app.request('http://x/?q=a');
  await app.request('http://x/?q=b');

  assert.equal(renders(), 2);
});
