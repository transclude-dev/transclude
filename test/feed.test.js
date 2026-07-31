// GET /feed.xml, from a list the app supplies.

import test from 'node:test';
import assert from 'node:assert/strict';

import { feed, feedPath, feedType } from '../src/feed.js';

const base = {
  hostname: 'https://acme.com',
  title: 'Acme',
  description: 'Latest from Acme.',
};

const posts = [
  { title: 'Second', path: '/posts/second', date: '2026-02-01', description: 'Later.' },
  { title: 'First', path: '/posts/first', date: '2026-01-01', description: 'Earlier.' },
];

const titles = (xml) => [...xml.matchAll(/<title>([^<]*)<\/title>/g)].map(([, t]) => t).slice(1);
const links = (xml) => [...xml.matchAll(/<link[^>]*>([^<]+)<\/link>|<link href="([^"]+)"/g)]
  .map(([, a, b]) => a ?? b);

// ---- what it produces ------------------------------------------------------

test('rss is the default, and it is a channel of items', async () => {
  const xml = await feed({ ...base, items: posts });

  assert.match(xml, /<rss version="2.0"/);
  assert.match(xml, /<channel>/);
  assert.equal(xml.match(/<item>/g).length, 2);
  assert.equal(feedType({}), 'application/rss+xml; charset=utf-8');
});

test('atom is a format, not a second config', async () => {
  const xml = await feed({ ...base, format: 'atom', author: { name: 'Ada' }, items: posts });

  assert.match(xml, /<feed xmlns="http:\/\/www.w3.org\/2005\/Atom">/);
  assert.equal(xml.match(/<entry>/g).length, 2);
  assert.equal(feedType({ format: 'atom' }), 'application/atom+xml; charset=utf-8');
});

test('a path is absolute in the output, because a feed is read elsewhere', async () => {
  const xml = await feed({ ...base, items: posts });
  assert.ok(links(xml).includes('https://acme.com/posts/first'));
});

test('a trailing slash on the hostname does not double up', async () => {
  const xml = await feed({ ...base, hostname: 'https://acme.com/', items: posts });
  assert.doesNotMatch(xml, /acme\.com\/\/posts/);
});

// ---- order and size --------------------------------------------------------

test('newest first, whatever order they were given in', async () => {
  const xml = await feed({ ...base, items: [...posts].reverse() });
  assert.deepEqual(titles(xml), ['Second', 'First']);
});

test('items with no date keep the order they came in, after the dated ones', async () => {
  // A stable sort, so a list with no dates at all is published as written
  // rather than shuffled.
  const xml = await feed({
    ...base,
    items: [
      { title: 'A', path: '/a' },
      { title: 'B', path: '/b' },
      { title: 'Dated', path: '/d', date: '2026-01-01' },
    ],
  });

  assert.deepEqual(titles(xml), ['Dated', 'A', 'B']);
});

test('the list is capped, and the cap keeps the newest', async () => {
  const many = Array.from({ length: 60 }, (_, i) => ({
    title: `p${i}`,
    path: `/p${i}`,
    date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
  }));

  const xml = await feed({ ...base, items: many });
  assert.equal(xml.match(/<item>/g).length, 50);

  const small = await feed({ ...base, items: many, limit: 3 });
  assert.equal(small.match(/<item>/g).length, 3);
});

test('items can be a function, for a list that has to be read', async () => {
  const asArray = await feed({ ...base, items: posts });
  const asFunction = await feed({ ...base, items: async () => posts });

  assert.equal(asArray, asFunction);
});

// ---- escaping --------------------------------------------------------------

test('a title with XML in it is escaped, not left to break the document', async () => {
  const xml = await feed({ ...base, items: [{ title: 'A & B <c>', path: '/x' }] });

  assert.match(xml, /A &amp; B &lt;c&gt;/);
  assert.doesNotMatch(xml, /<title>A & B/);
});

test('html content is kept as html, in CDATA', async () => {
  const xml = await feed({
    ...base,
    items: [{ title: 'x', path: '/x', content: '<p>real <em>markup</em></p>' }],
  });

  assert.match(xml, /<!\[CDATA\[<p>real <em>markup<\/em><\/p>\]\]>/);
});

test('content containing ]]> does not end the section early', async () => {
  // The one sequence CDATA cannot hold, and it turns up in ordinary markup.
  // Splitting it is what puts the three characters back together.
  const xml = await feed({
    ...base,
    items: [{ title: 'x', path: '/x', content: 'if (a[b[c]]>0)' }],
  });

  const inside = xml.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/)[1];

  // No bare `]]>` survives inside a section, which is what would end it early.
  assert.match(inside, /\]\]\]\]><!\[CDATA\[>/);
  // And what a parser puts back is the text that went in.
  const text = inside.replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '');
  assert.equal(text, 'if (a[b[c]]>0)');
});

// ---- dates -----------------------------------------------------------------

test('rss dates are RFC 822 and atom dates are RFC 3339', async () => {
  const asRss = await feed({ ...base, items: posts });
  const asAtom = await feed({ ...base, format: 'atom', author: { name: 'Ada' }, items: posts });

  assert.match(asRss, /<pubDate>\w{3}, \d{2} \w{3} \d{4} [\d:]{8} GMT<\/pubDate>/);
  assert.match(asAtom, /<updated>\d{4}-\d{2}-\d{2}T[\d:.]+Z<\/updated>/);
});

test('the feed is stamped from its newest item, never from the clock', async () => {
  // A prerendered feed is a file, written once and compressed once. Reading the
  // clock would change the bytes on every build for a feed that did not change.
  const once = await feed({ ...base, items: posts });
  const again = await feed({ ...base, items: posts });

  assert.equal(once, again);
  assert.match(once, /<lastBuildDate>Sun, 01 Feb 2026/);
});

test('an unparseable date is dropped rather than published as garbage', async () => {
  const xml = await feed({ ...base, items: [{ title: 'x', path: '/x', date: 'whenever' }] });
  assert.doesNotMatch(xml, /<pubDate>/);
});

// ---- what it refuses -------------------------------------------------------

test('no hostname and no title are errors, since neither has a default', async () => {
  await assert.rejects(() => feed({ title: 'x', items: [] }), /needs a hostname/);
  await assert.rejects(() => feed({ hostname: 'https://x.com', items: [] }), /needs a title/);
});

test('an atom feed with no author is refused, because the spec requires one', async () => {
  await assert.rejects(
    () => feed({ ...base, format: 'atom', items: posts }),
    /needs an author/,
  );
});

test('a per-item author satisfies atom without a feed-level one', async () => {
  const xml = await feed({
    ...base,
    format: 'atom',
    items: posts.map((post) => ({ ...post, author: { name: 'Ada', email: 'ada@x.com' } })),
  });

  assert.match(xml, /<author><name>Ada<\/name><email>ada@x.com<\/email><\/author>/);
});

test('an atom feed with no date anywhere is refused', async () => {
  // `updated` is required by the spec and there is no clock to fall back on.
  await assert.rejects(
    () => feed({ ...base, format: 'atom', author: { name: 'Ada' }, items: [{ title: 'x', path: '/x' }] }),
    /needs a date/,
  );
});

test('updated can be given, for a feed whose items carry no dates', async () => {
  const xml = await feed({
    ...base,
    format: 'atom',
    author: { name: 'Ada' },
    updated: '2026-03-01',
    items: [{ title: 'x', path: '/x' }],
  });

  assert.match(xml, /<updated>2026-03-01T00:00:00.000Z<\/updated>/);
});

// ---- where it lives --------------------------------------------------------

test('the path defaults, and can be named', () => {
  assert.equal(feedPath(undefined), '/feed.xml');
  assert.equal(feedPath({}), '/feed.xml');
  assert.equal(feedPath({ path: '/atom.xml' }), '/atom.xml');
});

test('the feed links to itself at the path it is served from', async () => {
  const xml = await feed({ ...base, path: '/atom.xml', items: posts });
  assert.match(xml, /rel="self"[^>]*acme\.com\/atom\.xml|acme\.com\/atom\.xml"[^>]*rel="self"/);
});

// ---- through the real app --------------------------------------------------

test('the app serves it at its path, with the type a reader looks for', async () => {
  // Mounting is the part a module test cannot see. `/feed.xml` reaching the
  // route table instead would be answered by a catch-all, or 404.
  const { createApp } = await import('../src/app.js');
  const bytes = (text) => new TextEncoder().encode(text);

  const app = createApp({
    config: {
      csrf: false,
      trailingSlash: 'never',
      feed: { ...base, path: '/atom.xml', format: 'atom', author: { name: 'Ada' }, items: posts },
    },
    manifest: { routes: [], endpoints: [] },
    pages: {},
    statics: { get: () => null },
    assets: { get: () => null },
    notFound: { body: bytes('nope'), etag: '"n"', encodings: new Map(), type: 'text/html' },
    errorPage: { body: bytes('broke'), etag: '"e"', encodings: new Map(), type: 'text/html' },
    hash: (body) => `"${body.length.toString(36)}"`,
    compress: null,
  });

  const response = await app.request('http://x/atom.xml');

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/atom+xml; charset=utf-8');
  assert.match(await response.text(), /<entry>/);
});

test('no feed in the config, no route', async () => {
  const { createApp } = await import('../src/app.js');
  const bytes = (text) => new TextEncoder().encode(text);

  const app = createApp({
    config: { csrf: false, trailingSlash: 'never' },
    manifest: { routes: [], endpoints: [] },
    pages: {},
    statics: { get: () => null },
    assets: { get: () => null },
    notFound: { body: bytes('nope'), etag: '"n"', encodings: new Map(), type: 'text/html' },
    errorPage: { body: bytes('broke'), etag: '"e"', encodings: new Map(), type: 'text/html' },
    hash: (body) => `"${body.length.toString(36)}"`,
    compress: null,
  });

  assert.equal((await app.request('http://x/feed.xml')).status, 404);
});
