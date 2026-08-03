import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { pool } from '../src/pool.js';
import { etagOf, loadAssets, loadStatic } from '../src/static-cache.js';
import { identityAcceptable, pickEncoding } from '../src/negotiate.js';
import { COMPRESSIBLE_FLOOR, compressResponse, precompress } from '../src/compress.js';
import zlib from 'node:zlib';

// ---- bounded concurrency ---------------------------------------------------

test('results keep their input order regardless of completion order', async () => {
  const delays = [30, 1, 20, 2, 10];
  const out = await pool(delays, 3, async (ms, i) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return i;
  });
  assert.deepEqual(out, [0, 1, 2, 3, 4]);
});

test('no more than the limit run at once', async () => {
  let inFlight = 0;
  let peak = 0;

  await pool(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 1));
    inFlight--;
  });

  assert.ok(peak <= 4, `peak was ${peak}`);
  assert.ok(peak > 1, 'nothing ran concurrently at all');
});

test('every item runs even when there are fewer than the limit', async () => {
  const seen = [];
  await pool([1, 2], 8, async (n) => seen.push(n));
  assert.deepEqual(seen.sort(), [1, 2]);
});

test('an empty list is not a hang', async () => {
  assert.deepEqual(await pool([], 4, async () => 1), []);
});

test('a throwing worker rejects rather than being swallowed', async () => {
  await assert.rejects(
    pool([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('boom');
      return n;
    }),
    /boom/,
  );
});

// ---- the static cache ------------------------------------------------------

function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-static-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return dir;
}

test('index.html files map to the URL they stand for', () => {
  const cache = loadStatic(
    fixture({
      'index.html': '<p>home</p>',
      'check/index.html': '<p>check</p>',
      'people/ada/index.html': '<p>ada</p>',
    }),
  );

  assert.equal(cache.get('/').body.toString(), '<p>home</p>');
  assert.equal(cache.get('/check').body.toString(), '<p>check</p>');
  assert.equal(cache.get('/people/ada').body.toString(), '<p>ada</p>');
  assert.equal(cache.get('/nope'), null);
});

test('a trailing slash is the same page', () => {
  const cache = loadStatic(fixture({ 'check/index.html': '<p>check</p>' }));
  assert.equal(cache.get('/check/').body.toString(), '<p>check</p>');
  assert.equal(cache.get('/check///').body.toString(), '<p>check</p>');
});

test('404.html is not a routable URL', () => {
  const cache = loadStatic(fixture({ 'index.html': '<p>x</p>', '404.html': '<p>404</p>' }));
  assert.equal(cache.count, 1);
  assert.equal(cache.get('/404'), null);
});

test('each page carries a stable etag derived from its content', () => {
  const cache = loadStatic(fixture({ 'index.html': '<p>home</p>' }));
  assert.equal(cache.get('/').etag, etagOf('<p>home</p>'));
  assert.notEqual(etagOf('<p>a</p>'), etagOf('<p>b</p>'));
  assert.match(cache.get('/').etag, /^"[A-Za-z0-9_-]+"$/);
});

test('pages past the budget stay routable, read per request', () => {
  const dir = fixture({
    'a/index.html': 'x'.repeat(400),
    'b/index.html': 'y'.repeat(400),
    'c/index.html': 'z'.repeat(400),
  });
  const cache = loadStatic(dir, { maxBytes: 500 });

  assert.equal(cache.count, 3, 'every route is still known');
  assert.ok(cache.onDisk >= 1, 'something fell outside the budget');
  assert.ok(cache.bytes <= 500);

  // Whichever ones spilled still serve correctly, with an etag.
  for (const url of ['/a', '/b', '/c']) {
    const page = cache.get(url);
    assert.equal(page.body.length, 400);
    assert.equal(page.etag, etagOf(page.body));
  }
});

test('a missing directory is empty, not a crash', () => {
  const cache = loadStatic(path.join(os.tmpdir(), 'hf-static-does-not-exist'));
  assert.equal(cache.count, 0);
  assert.equal(cache.get('/'), null);
});

// ---- content negotiation ---------------------------------------------------

test('the best acceptable encoding wins', () => {
  assert.equal(pickEncoding('br, gzip', ['br', 'gzip']), 'br');
  assert.equal(pickEncoding('gzip', ['br', 'gzip']), 'gzip');
  assert.equal(pickEncoding('gzip;q=1.0, br;q=0.5', ['br', 'gzip']), 'gzip');
});

test('q=0 is a refusal, not a low preference', () => {
  assert.equal(pickEncoding('br;q=0, gzip', ['br', 'gzip']), 'gzip');
  assert.equal(pickEncoding('br;q=0, gzip;q=0', ['br', 'gzip']), null);
});

test('an encoding the client never mentioned is never sent', () => {
  // The failure mode this prevents is a corrupt response, not a missed byte.
  assert.equal(pickEncoding('gzip', ['br']), null);
  assert.equal(pickEncoding('deflate', ['br', 'gzip']), null);
});

test('no header means no preference, so nothing encoded is assumed', () => {
  assert.equal(pickEncoding('', ['br', 'gzip']), null);
  assert.equal(pickEncoding(undefined, ['br', 'gzip']), null);
});

test('a wildcard accepts what is available', () => {
  assert.equal(pickEncoding('*', ['br', 'gzip']), 'br');
  assert.equal(pickEncoding('*;q=0, gzip', ['br', 'gzip']), 'gzip');
});

test('nothing available means nothing chosen', () => {
  assert.equal(pickEncoding('br, gzip', []), null);
});

test('identity is acceptable unless it is refused outright', () => {
  assert.equal(identityAcceptable('br, gzip'), true);
  assert.equal(identityAcceptable(''), true);
  assert.equal(identityAcceptable('br, identity;q=0'), false);
  assert.equal(identityAcceptable('br, *;q=0'), false);
});

// ---- precompression --------------------------------------------------------

test('variants are written, and each gets its own etag', async () => {
  const dir = fixture({ 'index.html': `<p>${'compressible '.repeat(200)}</p>` });
  const stats = await precompress([dir]);

  assert.equal(stats.files, 1);
  assert.ok(fs.existsSync(path.join(dir, 'index.html.br')));
  assert.ok(fs.existsSync(path.join(dir, 'index.html.gz')));
  assert.ok(stats.brotli < stats.gzip, 'brotli at quality 11 should beat gzip');

  const page = loadStatic(dir).get('/');
  assert.equal(page.encodings.get('br').etag, `${page.etag.slice(0, -1)}-br"`);
  assert.equal(page.encodings.get('gzip').etag, `${page.etag.slice(0, -1)}-gzip"`);
  assert.notEqual(page.encodings.get('br').etag, page.encodings.get('gzip').etag);
});

test('small files are left alone, because framing would make them bigger', async () => {
  const dir = fixture({ 'index.html': '<p>hi</p>' });
  const stats = await precompress([dir]);

  assert.equal(stats.files, 0);
  assert.equal(fs.existsSync(path.join(dir, 'index.html.br')), false);
  assert.equal(loadStatic(dir).get('/').encodings.size, 0);
});

test('incompressible content does not get a larger variant written', async () => {
  // Random bytes do not compress; writing a bigger file would be a pessimisation.
  const noise = Array.from({ length: 4000 }, (_, i) => String.fromCharCode(33 + ((i * 7919) % 94))).join('');
  const dir = fixture({ 'a.txt': noise });
  await precompress([dir]);

  for (const suffix of ['.br', '.gz']) {
    const variant = path.join(dir, `a.txt${suffix}`);
    if (fs.existsSync(variant)) {
      assert.ok(fs.statSync(variant).size < noise.length, `${suffix} was written larger than the source`);
    }
  }
});

test('variants are not served as resources of their own', async () => {
  const dir = fixture({ 'index.html': `<p>${'x '.repeat(400)}</p>` });
  await precompress([dir]);

  const cache = loadStatic(dir);
  assert.equal(cache.count, 1, 'the .br and .gz are variants, not pages');
});

test('assets keep their path and get a content type', () => {
  const dir = fixture({ 'assets/app-abc123.js': 'export const a = 1;' });
  const asset = loadAssets(dir).get('/assets/app-abc123.js');
  assert.match(asset.type, /text\/javascript/);
  assert.equal(asset.body.toString(), 'export const a = 1;');
});

// ---- compressing a response on the way out ---------------------------------

test('a rendered response compresses, and decodes back to what went in', async () => {
  const html = `<p>${'server rendered '.repeat(120)}</p>`;
  const body = Buffer.from(html);

  const br = await compressResponse(body, 'br');
  const gz = await compressResponse(body, 'gzip');

  assert.ok(br.length < body.length);
  assert.ok(gz.length < body.length);
  assert.equal(zlib.brotliDecompressSync(br).toString(), html);
  assert.equal(zlib.gunzipSync(gz).toString(), html);
});

test('per-request brotli runs at quality 5, not the build-time maximum', async () => {
  // Pinned by construction rather than by comparing sizes: brotli levels are not
  // monotonic on ratio, and on degenerate input q5 can beat q11 outright.
  const body = Buffer.from(`<p>${'server rendered '.repeat(120)}</p>`);
  const actual = await compressResponse(body, 'br');
  const q5 = zlib.brotliCompressSync(body, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 5,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: body.length,
    },
  });

  assert.deepEqual(actual, q5, 'the per-request path changed level');
  assert.ok(actual.length < body.length);
});

test('an unknown encoding passes the body through untouched', async () => {
  const body = Buffer.from('hello');
  assert.equal(await compressResponse(body, 'identity'), body);
  assert.equal(await compressResponse(body, undefined), body);
});

test('the floor is shared with the build, so both agree what is worth encoding', () => {
  assert.equal(COMPRESSIBLE_FLOOR, 512);
});

// ---- reporting a failure ---------------------------------------------------

const { createApp } = await import('../src/app.js');
const bytes = (t) => new TextEncoder().encode(t);

/** An app whose only page throws, so every request reaches `internalError`. */
function appThatThrows(config) {
  return createApp({
    config: { csrf: false, trailingSlash: 'never', cookieSecret: 's', ...config },
    manifest: { routes: [{ id: 'index', pattern: '/', params: [], client: null }], endpoints: [] },
    pages: {
      index: {
        revalidate: 0,
        layouts: [],
        css: '',
        headScript: '',
        hasTitle: false,
        renderTitle: () => '',
        renderHead: () => '',
        elements: [],
        includes: [],
        regions: {},
        load: async () => {
          throw new Error('loader gave up');
        },
        render: () => ({ default: '' }),
      },
    },
    statics: { get: () => null },
    assets: { get: () => null },
    notFound: { body: bytes('nope'), etag: '"n"', encodings: new Map(), type: 'text/html' },
    errorPage: { body: bytes('broke'), etag: '"e"', encodings: new Map(), type: 'text/html' },
    hash: (b) => `"${b.length.toString(36)}"`,
    compress: null,
  });
}

// A failed request logs by design. These make it fail on purpose, so the log is
// noise rather than news.
const quietly = async (fn) => {
  const real = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = real;
  }
};

test('a 500 goes to onError with the request, and the page still ships', async () => {
  const seen = [];
  const app = appThatThrows({ onError: (err, ctx) => seen.push({ err, ctx }) });

  const res = await quietly(() => app.request('http://x/'));

  assert.equal(res.status, 500);
  assert.equal(seen.length, 1);
  assert.match(seen[0].err.message, /loader gave up/);
  assert.equal(seen[0].ctx.url, 'http://x/');
  assert.equal(seen[0].ctx.method, 'GET');
});

test('a reporter that throws does not replace the error it was given', async () => {
  // The one failure mode a reporting hook must not have. Without the guard the
  // visitor sees the reporter's stack instead of the 500 page.
  const app = appThatThrows({
    onError: () => {
      throw new Error('the reporter is down');
    },
  });

  const res = await quietly(() => app.request('http://x/'));
  assert.equal(res.status, 500);
  assert.match(await res.text(), /broke/, 'the error page did not ship');
});

test('with no hook it still logs, and says nothing to the visitor', async () => {
  const app = appThatThrows({});
  const res = await quietly(() => app.request('http://x/'));

  assert.equal(res.status, 500);
  assert.doesNotMatch(await res.text(), /loader gave up/, 'the message reached the body');
});

// ---- what a page will ask for ----------------------------------------------

const pageApp = (over = {}) =>
  createApp({
    config: { csrf: false, trailingSlash: 'never', cookieSecret: 's', fragmentParam: 'fragment' },
    manifest: {
      stylesheet: '/assets/site-abc.css',
      routes: [{ id: 'index', pattern: '/', params: [], client: '/assets/index-def.js' }],
      endpoints: [],
    },
    pages: {
      index: {
        revalidate: 0,
        layouts: [],
        css: '',
        headScript: '',
        hasTitle: false,
        renderTitle: () => '',
        renderHead: () => '',
        elements: [],
        includes: [],
        regions: { part: () => '<p>region</p>' },
        load: async () => ({}),
        render: () => ({ default: '<p>page</p>' }),
        ...over,
      },
    },
    statics: { get: () => null },
    assets: { get: () => null },
    notFound: { body: bytes('nope'), etag: '"n"', encodings: new Map(), type: 'text/html' },
    errorPage: { body: bytes('broke'), etag: '"e"', encodings: new Map(), type: 'text/html' },
    hash: (b) => `"${b.length.toString(36)}"`,
    compress: null,
  });

test('a document says what it is going to fetch, so a proxy can send a 103', async () => {
  const res = await pageApp().request('http://x/');
  const link = res.headers.get('link');

  assert.match(link, /<\/assets\/site-abc\.css>; rel=preload; as=style/);
  assert.match(link, /<\/assets\/index-def\.js>; rel=preload; as=script/);
});

test('a region carries none of it, because it has no head to fill', async () => {
  const res = await pageApp().request('http://x/?fragment=part');

  assert.equal(res.status, 200);
  assert.equal(res.headers.get('link'), null);
});

test('the hint is not a header on the page, so the page is still cacheable', async () => {
  // A header written by a loader is one of the things that makes a page too
  // personal to hold. This one is set on the way out instead, so a second
  // request for a page with a revalidate window is still a cache hit.
  let renders = 0;
  const app = pageApp({ revalidate: 60, load: async () => (renders++, {}) });

  await app.request('http://x/');
  await app.request('http://x/');

  assert.equal(renders, 1, 'the preload header made the page uncacheable');
});
