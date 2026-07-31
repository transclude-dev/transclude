// GET /sitemap.xml, from the route table.

import test from 'node:test';
import assert from 'node:assert/strict';

import { sitemap, sitemapEntries } from '../src/sitemap.js';

const manifest = {
  routes: [
    { id: 'index', pattern: '/', params: [] },
    { id: 'about', pattern: '/about', params: [] },
    { id: 'person', pattern: '/people/:name', params: ['name'] },
    { id: 'docs', pattern: '/docs/:path{.+}', params: ['path'] },
  ],
};

const pages = {
  index: {},
  about: {},
  person: { paths: () => [{ name: 'ada' }, { name: 'grace' }] },
  docs: {}, // no `paths`: server-rendered for URLs nobody listed
};

const locs = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, loc]) => loc);

test('a route with no parameters is one URL', async () => {
  const xml = await sitemap(manifest, pages, { hostname: 'https://x.com' });
  assert.ok(locs(xml).includes('https://x.com/'));
  assert.ok(locs(xml).includes('https://x.com/about'));
});

test('a parameter route is listed from its own paths export', async () => {
  // The same list the build prerenders, so the two cannot disagree about which
  // URLs exist.
  const xml = await sitemap(manifest, pages, { hostname: 'https://x.com' });
  assert.ok(locs(xml).includes('https://x.com/people/ada'));
  assert.ok(locs(xml).includes('https://x.com/people/grace'));
});

test('a parameter route with no paths is not advertised', async () => {
  // Listing the pattern would advertise `/docs/:path{.+}` to a crawler.
  const xml = await sitemap(manifest, pages, { hostname: 'https://x.com' });
  // `:` alone matches `https:`, which every loc has.
  assert.ok(!locs(xml).some((loc) => /\/:|\{/.test(loc)));
  assert.ok(!locs(xml).some((loc) => loc.includes('/docs/')));
});

test('extra entries can be added, as an array or a function', async () => {
  const asArray = await sitemap(manifest, pages, {
    hostname: 'https://x.com',
    entries: [{ path: '/blog/hello' }],
  });
  const asFunction = await sitemap(manifest, pages, {
    hostname: 'https://x.com',
    entries: async () => [{ path: '/blog/hello' }],
  });

  assert.ok(locs(asArray).includes('https://x.com/blog/hello'));
  assert.deepEqual(locs(asArray), locs(asFunction));
});

test('exclude takes a path or a pattern', async () => {
  const xml = await sitemap(manifest, pages, {
    hostname: 'https://x.com',
    exclude: ['/about', /^\/people\//],
  });

  assert.deepEqual(locs(xml), ['https://x.com/']);
});

test('a duplicate path is listed once', async () => {
  const xml = await sitemap(manifest, pages, {
    hostname: 'https://x.com',
    entries: [{ path: '/about' }],
  });

  assert.equal(locs(xml).filter((loc) => loc.endsWith('/about')).length, 1);
});

test('optional fields are emitted only when given', async () => {
  const xml = await sitemap({ routes: [] }, {}, {
    hostname: 'https://x.com',
    entries: [
      { path: '/a', lastmod: '2026-07-31', changefreq: 'daily', priority: '0.8' },
      { path: '/b' },
    ],
  });

  assert.match(xml, /<lastmod>2026-07-31<\/lastmod>/);
  assert.match(xml, /<changefreq>daily<\/changefreq>/);
  assert.equal(xml.match(/<lastmod>/g).length, 1, 'the entry with no date got one');
});

test('a Date is written as a day, and something unparseable is dropped', async () => {
  const xml = await sitemap({ routes: [] }, {}, {
    hostname: 'https://x.com',
    entries: [
      { path: '/a', lastmod: new Date('2026-07-31T12:00:00Z') },
      { path: '/b', lastmod: 'not a date' },
    ],
  });

  assert.match(xml, /<lastmod>2026-07-31<\/lastmod>/);
  assert.equal(xml.match(/<lastmod>/g).length, 1);
});

test('a URL with characters XML cares about is escaped', async () => {
  const xml = await sitemap({ routes: [] }, {}, {
    hostname: 'https://x.com',
    entries: [{ path: '/search?q=a&b' }],
  });

  assert.match(xml, /&amp;/);
  assert.doesNotMatch(xml, /q=a&b/);
});

test('past the cap the bare path is an index and ?p= is a slice', async () => {
  const many = Array.from({ length: 5 }, (_, i) => ({ path: `/p${i}` }));
  const config = { hostname: 'https://x.com', entries: many, limit: 2 };

  const idx = await sitemap({ routes: [] }, {}, config);
  assert.match(idx, /<sitemapindex/);
  assert.deepEqual(locs(idx), [
    'https://x.com/sitemap.xml?p=0',
    'https://x.com/sitemap.xml?p=1',
    'https://x.com/sitemap.xml?p=2',
  ]);

  const slice = await sitemap({ routes: [] }, {}, config, '1');
  assert.deepEqual(locs(slice), ['https://x.com/p2', 'https://x.com/p3']);
});

test('under the cap there is no index, only a urlset', async () => {
  const xml = await sitemap({ routes: [] }, {}, {
    hostname: 'https://x.com',
    entries: [{ path: '/a' }],
    limit: 2,
  });

  assert.match(xml, /<urlset/);
  assert.doesNotMatch(xml, /sitemapindex/);
});

test('no hostname is an error, because every loc is absolute', async () => {
  await assert.rejects(() => sitemap(manifest, pages, {}), /needs a hostname/);
});

test('entries are reusable on their own, for a feed or anything else', async () => {
  const entries = await sitemapEntries(manifest, pages, {});
  assert.deepEqual(entries.map((e) => e.path), ['/', '/about', '/people/ada', '/people/grace']);
});
