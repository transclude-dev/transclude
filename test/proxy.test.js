// Fetching a foreign document and answering with one fragment of it.
//
// No real network. `fetch` arrives as a dependency, so every response here is
// written out and the checks are exercised against exactly what they would see.

import test from 'node:test';
import assert from 'node:assert/strict';

import { documentStore, PROXY_PATH, proxyHandler, readForeign } from '../src/proxy.js';

const ALLOW = { allow: ['source.example'] };

const PAGE =
  '<html><head><title>Guide</title></head><body>' +
  '<h2 id="install">Install</h2><p>Run <a href="/setup">setup</a>.</p>' +
  '<h2 id="use">Use</h2><p>Use it.</p>' +
  '</body></html>';

/** A fetch that answers from a table, and records what it was asked. */
function fakeFetch(routes) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, headers: init?.headers ?? {} });
    const answer = routes[url];
    if (!answer) throw new Error(`nothing at ${url}`);
    return typeof answer === 'function' ? answer(init) : answer;
  };
  return { fetch, calls };
}

const html = (body, headers = {}) =>
  new Response(body, { status: 200, headers: { 'content-type': 'text/html', ...headers } });

const request = (query) => new Request(`https://host.example${PROXY_PATH}?${query}`);

// ---- the happy path --------------------------------------------------------

test('the proxy answers with the fragment the request named', async () => {
  const { fetch } = fakeFetch({ 'https://source.example/guide': html(PAGE) });
  const handler = proxyHandler(ALLOW, { fetch });

  const response = await handler(request('url=https://source.example/guide&id=install'));
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.match(body, /<h2 id="install">Install<\/h2>/);
  assert.doesNotMatch(body, /Use it/, 'the run did not stop at the next heading');
  assert.doesNotMatch(body, /<html|<title/, 'a whole document came back');
});

test('relative links in the answer point back at the source', async () => {
  const { fetch } = fakeFetch({ 'https://source.example/guide': html(PAGE) });
  const handler = proxyHandler(ALLOW, { fetch });

  const body = await (await handler(request('url=https://source.example/guide&id=install'))).text();
  assert.match(body, /href="https:\/\/source\.example\/setup"/);
});

test('an id nobody has is a 404 naming it', async () => {
  const { fetch } = fakeFetch({ 'https://source.example/guide': html(PAGE) });
  const handler = proxyHandler(ALLOW, { fetch });

  const response = await handler(request('url=https://source.example/guide&id=nope'));
  assert.equal(response.status, 404);
  assert.match(await response.text(), /nope/);
});

test('with no id the answer is the outline', async () => {
  const { fetch } = fakeFetch({ 'https://source.example/guide': html(PAGE) });
  const handler = proxyHandler(ALLOW, { fetch });

  const body = await (await handler(request('url=https://source.example/guide'))).json();
  assert.deepEqual(body.fragments.map((f) => f.id), ['install', 'use']);
});

test('no url at all is a 400', async () => {
  const handler = proxyHandler(ALLOW, { fetch: async () => html('') });
  assert.equal((await handler(request('id=x'))).status, 400);
});

// ---- what it refuses -------------------------------------------------------

test('a host nobody allowed is refused before anything is fetched', async () => {
  const { fetch, calls } = fakeFetch({});
  const handler = proxyHandler(ALLOW, { fetch });

  const response = await handler(request('url=https://evil.example/x&id=a'));

  assert.equal(response.status, 403);
  assert.equal(calls.length, 0, 'it connected to a host it had already refused');
});

test('a redirect to a private address is refused at that hop', async () => {
  // The check that matters most. The first URL is allowed and public; the
  // second is neither, and only re-checking each hop catches it.
  const { fetch, calls } = fakeFetch({
    'https://source.example/guide': new Response(null, {
      status: 302,
      headers: { location: 'http://169.254.169.254/latest/meta-data/' },
    }),
  });
  const handler = proxyHandler(ALLOW, { fetch });

  const response = await handler(request('url=https://source.example/guide&id=a'));

  assert.equal(response.status, 403);
  assert.match(await response.text(), /not an allowed host/);
  assert.equal(calls.length, 1, 'it followed the redirect before checking it');
});

test('a redirect to another allowed page is followed', async () => {
  const { fetch } = fakeFetch({
    'https://source.example/old': new Response(null, {
      status: 301,
      headers: { location: '/guide' },
    }),
    'https://source.example/guide': html(PAGE),
  });
  const handler = proxyHandler(ALLOW, { fetch });

  const response = await handler(request('url=https://source.example/old&id=install'));
  assert.equal(response.status, 200);
});

test('a redirect loop stops at the cap', async () => {
  const { fetch, calls } = fakeFetch({
    'https://source.example/a': new Response(null, { status: 302, headers: { location: '/a' } }),
  });
  const handler = proxyHandler({ ...ALLOW, redirects: 3 }, { fetch });

  const response = await handler(request('url=https://source.example/a&id=x'));

  assert.equal(response.status, 502);
  assert.equal(calls.length, 4, 'the cap counts hops, not attempts');
});

test('anything that is not html is refused', async () => {
  const { fetch } = fakeFetch({
    'https://source.example/x': new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  });
  const handler = proxyHandler(ALLOW, { fetch });

  const response = await handler(request('url=https://source.example/x&id=a'));
  assert.equal(response.status, 415);
});

test('a document over the cap is refused, by claim and by count', async () => {
  const big = 'x'.repeat(200);

  const byClaim = fakeFetch({
    'https://source.example/x': html(big, { 'content-length': '200' }),
  });
  assert.equal(
    (await proxyHandler({ ...ALLOW, maxBytes: 100 }, byClaim).call(
      null,
      request('url=https://source.example/x&id=a'),
    )).status,
    413,
  );

  // No content-length, so only counting the bytes catches it.
  const byCount = fakeFetch({ 'https://source.example/x': html(big) });
  const response = await proxyHandler({ ...ALLOW, maxBytes: 100 }, byCount)(
    request('url=https://source.example/x&id=a'),
  );
  assert.equal(response.status, 413);
});

test('a source that fails is a 502, and its status is not passed through', async () => {
  const { fetch } = fakeFetch({
    'https://source.example/x': new Response('gone', { status: 404 }),
  });
  const handler = proxyHandler(ALLOW, { fetch });

  assert.equal((await handler(request('url=https://source.example/x&id=a'))).status, 502);
});

test('a source that hangs is a 504 rather than an unhandled throw', async () => {
  const { fetch } = fakeFetch({
    'https://source.example/x': () => {
      const error = new Error('timed out');
      error.name = 'TimeoutError';
      throw error;
    },
  });
  const handler = proxyHandler(ALLOW, { fetch });

  assert.equal((await handler(request('url=https://source.example/x&id=a'))).status, 504);
});

// ---- the resolver hook -----------------------------------------------------

test('a name that resolves somewhere private is refused, when a resolver is given', async () => {
  // The half that cannot live in the core: one of the four runtimes has no DNS
  // at all, so this arrives as a function or not at all.
  const { fetch, calls } = fakeFetch({ 'https://source.example/guide': html(PAGE) });
  const lookup = async (host) => (host === 'source.example' ? 'loopback' : null);

  const handler = proxyHandler(ALLOW, { fetch, lookup });
  const response = await handler(request('url=https://source.example/guide&id=install'));

  assert.equal(response.status, 403);
  assert.match(await response.text(), /resolves to loopback/);
  assert.equal(calls.length, 0, 'it connected before the name was resolved');
});

test('with no resolver the allowlist is what stands, and it still works', async () => {
  const { fetch } = fakeFetch({ 'https://source.example/guide': html(PAGE) });
  const handler = proxyHandler(ALLOW, { fetch });

  assert.equal((await handler(request('url=https://source.example/guide&id=install'))).status, 200);
});

// ---- sanitizing ------------------------------------------------------------

test('script and event handlers do not come back', async () => {
  const nasty =
    '<h2 id="a">A</h2><script>steal()</script><p onclick="steal()">one</p>' +
    '<a href="javascript:steal()">x</a>';
  const { fetch } = fakeFetch({ 'https://source.example/x': html(nasty) });

  const body = await (
    await proxyHandler(ALLOW, { fetch })(request('url=https://source.example/x&id=a'))
  ).text();

  assert.doesNotMatch(body, /steal|<script|onclick|javascript:/);
  assert.match(body, /<h2 id="a">A<\/h2>/);
});

test('a style block does not come back, because it would restyle the host page', async () => {
  const source = '<h2 id="a">A</h2><style>body{display:none}</style><p style="color:red">one</p>';
  const { fetch } = fakeFetch({ 'https://source.example/x': html(source) });

  const body = await (
    await proxyHandler(ALLOW, { fetch })(request('url=https://source.example/x&id=a'))
  ).text();

  assert.doesNotMatch(body, /<style|display:none/);
  // The attribute is the other kind. It paints its own element and stays.
  assert.match(body, /style="color:red"/);
});

test("proxy.styles: 'strip' takes the attributes too", async () => {
  const source = '<h2 id="a">A</h2><p style="color:red">one</p>';
  const { fetch } = fakeFetch({ 'https://source.example/x': html(source) });
  const config = { ...ALLOW, styles: 'strip' };

  const body = await (
    await proxyHandler(config, { fetch })(request('url=https://source.example/x&id=a'))
  ).text();

  assert.doesNotMatch(body, /style=/);
  assert.match(body, /<p>one<\/p>/);
});

test('a styles value nobody recognizes throws rather than quietly keeping them', async () => {
  const { fetch } = fakeFetch({ 'https://source.example/x': html('<h2 id="a">A</h2>') });

  await assert.rejects(
    () => readForeign('https://source.example/x', { ...ALLOW, styles: 'none' }, { fetch }),
    /proxy\.styles is "none"/,
  );
});

test('the index is built after cleaning, so it names nothing that was removed', async () => {
  // Indexing first would list `gone` and then fail to resolve it.
  const source = '<h2 id="a">A</h2><iframe id="gone"></iframe>';
  const { fetch } = fakeFetch({ 'https://source.example/x': html(source) });

  const body = await (
    await proxyHandler(ALLOW, { fetch })(request('url=https://source.example/x'))
  ).json();

  assert.deepEqual(body.fragments.map((f) => f.id), ['a']);
});

// ---- caching ---------------------------------------------------------------

test('several fragments from one page cost one request', async () => {
  // The reason the document is cached rather than the fragment. Without the
  // freshness window each of these revalidates, which is a round trip apiece
  // for markup we are already holding.
  const { fetch, calls } = fakeFetch({ 'https://source.example/guide': html(PAGE) });
  const store = documentStore();
  const handler = proxyHandler(ALLOW, { fetch, store, now: () => 1000 });

  const install = await (await handler(request('url=https://source.example/guide&id=install'))).text();
  const use = await (await handler(request('url=https://source.example/guide&id=use'))).text();

  assert.equal(calls.length, 1, 'the second fragment went back to the source');
  assert.match(install, /Install/);
  assert.match(use, /Use it/);
});

test('past the window it revalidates rather than serving forever', async () => {
  const { fetch, calls } = fakeFetch({ 'https://source.example/guide': html(PAGE) });
  const store = documentStore();
  let clock = 1000;

  const handler = proxyHandler({ ...ALLOW, maxAge: 100 }, { fetch, store, now: () => clock });

  await handler(request('url=https://source.example/guide&id=install'));
  clock += 500;
  await handler(request('url=https://source.example/guide&id=install'));

  assert.equal(calls.length, 2);
});

test('a 304 keeps the document that is already held', async () => {
  let served = 0;
  const fetch = async (url, init) => {
    served += 1;
    if (init.headers?.['if-none-match'] === '"v1"') return new Response(null, { status: 304 });
    return html(PAGE, { etag: '"v1"' });
  };

  const store = documentStore();
  const handler = proxyHandler({ ...ALLOW, maxAge: 0 }, { fetch, store });

  const first = await (await handler(request('url=https://source.example/guide&id=install'))).text();
  const second = await (await handler(request('url=https://source.example/guide&id=install'))).text();

  assert.equal(served, 2);
  assert.equal(first, second);
});

test('the second request sends the validators the first was given', async () => {
  const { fetch, calls } = fakeFetch({
    'https://source.example/guide': html(PAGE, {
      etag: '"v1"',
      'last-modified': 'Wed, 01 Jul 2026 00:00:00 GMT',
    }),
  });
  const store = documentStore();
  const handler = proxyHandler({ ...ALLOW, maxAge: 0 }, { fetch, store });

  await handler(request('url=https://source.example/guide&id=install'));
  await handler(request('url=https://source.example/guide&id=install'));

  assert.equal(calls[0].headers['if-none-match'], undefined);
  assert.equal(calls[1].headers['if-none-match'], '"v1"');
});

test('the store holds a bounded number of documents', async () => {
  const store = documentStore(2);
  for (const key of ['a', 'b', 'c']) store.set(key, { doc: key });

  assert.equal(store.size, 2);
  assert.equal(store.get('a'), null, 'the oldest was not dropped');
  assert.ok(store.get('c'));
});

test('a hit keeps a document from being the next one dropped', async () => {
  const store = documentStore(2);
  store.set('a', { doc: 'a' });
  store.set('b', { doc: 'b' });
  store.get('a');
  store.set('c', { doc: 'c' });

  assert.ok(store.get('a'), 'the one just used was dropped');
  assert.equal(store.get('b'), null);
});

// ---- readForeign on its own ------------------------------------------------

test('readForeign hands back the indexed document and what it removed', async () => {
  const { fetch } = fakeFetch({
    'https://source.example/x': html('<h2 id="a">A</h2><script>x()</script>'),
  });

  const entry = await readForeign('https://source.example/x', ALLOW, { fetch });

  assert.deepEqual(entry.removed, ['script']);
  assert.equal(entry.base, 'https://source.example/x');
  assert.ok(entry.doc.ids.has('a'));
});

test('a base element in the source decides what relative URLs resolve against', async () => {
  const { fetch } = fakeFetch({
    'https://source.example/deep/page': html(
      '<html><head><base href="https://source.example/root/"></head>' +
        '<body><h2 id="a">A</h2><a href="x.html">x</a></body></html>',
    ),
  });

  const entry = await readForeign('https://source.example/deep/page', ALLOW, { fetch });
  const found = (await import('../src/extract.js')).resolveFragment(entry.doc, 'a');

  assert.equal(entry.base, 'https://source.example/root/');
  assert.match(found.html, /href="https:\/\/source\.example\/root\/x\.html"/);
});

// ---- through the real app --------------------------------------------------

test('no proxy in the config means no route', async () => {
  const { createApp } = await import('../src/app.js');
  const bytes = (t) => new TextEncoder().encode(t);
  const app = createApp({
    config: { csrf: false, trailingSlash: 'never' },
    manifest: { routes: [], endpoints: [] },
    pages: {},
    statics: { get: () => null },
    assets: { get: () => null },
    notFound: { body: bytes('nope'), etag: '"n"', encodings: new Map(), type: 'text/html' },
    errorPage: { body: bytes('broke'), etag: '"e"', encodings: new Map(), type: 'text/html' },
    hash: (b) => `"${b.length.toString(36)}"`,
    compress: null,
  });

  assert.equal((await app.request(`http://x${PROXY_PATH}?url=https://source.example/`)).status, 404);
});

test('the app mounts it, and the injected resolver reaches it', async () => {
  const { createApp } = await import('../src/app.js');
  const bytes = (t) => new TextEncoder().encode(t);
  const asked = [];

  const app = createApp({
    config: {
      csrf: false,
      trailingSlash: 'never',
      proxy: { allow: ['source.example'], fetch: undefined },
    },
    lookup: async (host) => (asked.push(host), null),
    manifest: { routes: [], endpoints: [] },
    pages: {},
    statics: { get: () => null },
    assets: { get: () => null },
    notFound: { body: bytes('nope'), etag: '"n"', encodings: new Map(), type: 'text/html' },
    errorPage: { body: bytes('broke'), etag: '"e"', encodings: new Map(), type: 'text/html' },
    hash: (b) => `"${b.length.toString(36)}"`,
    compress: null,
  });

  // Nothing is allowed to reach the network here, so the refusal is the proof
  // the route exists and the checks run.
  const response = await app.request(`http://x${PROXY_PATH}?url=https://evil.example/&id=a`);

  assert.equal(response.status, 403);
  assert.deepEqual(asked, [], 'a refused host was still resolved');
});
