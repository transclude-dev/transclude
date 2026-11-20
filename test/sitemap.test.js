// GET /sitemap.xml, from the route table.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { sitemap, sitemapEntries, sitemapFiles } from '../src/sitemap.js';

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

test('an entry naming a path a route already found fills its fields in', async () => {
  // `/people/ada` comes from the page's own `paths()`, which knows the URL and
  // no date. The config names it again to carry the date, and the sitemap still
  // lists the URL once, where the route table put it.
  const entries = await sitemapEntries(manifest, pages, {
    entries: [{ path: '/people/ada', lastmod: '2026-07-31' }],
  });

  assert.deepEqual(entries.map((e) => e.path), ['/', '/about', '/people/ada', '/people/grace']);
  assert.equal(entries.find((e) => e.path === '/people/ada').lastmod, '2026-07-31');

  const xml = await sitemap(manifest, pages, {
    hostname: 'https://x.com',
    entries: [{ path: '/people/ada', lastmod: '2026-07-31' }],
  });

  assert.equal(locs(xml).filter((loc) => loc.endsWith('/people/ada')).length, 1);
  assert.match(xml, /<loc>https:\/\/x\.com\/people\/ada<\/loc><lastmod>2026-07-31<\/lastmod>/);
});

test('exclude and the gate hold a path back however often it is named', async () => {
  const entries = await sitemapEntries({ ...manifest, gated: ['/people/ada'] }, pages, {
    entries: [{ path: '/about', lastmod: '2026-07-31' }],
    exclude: ['/about'],
  });

  assert.deepEqual(entries.map((e) => e.path), ['/', '/people/grace']);
});

test('optional fields are emitted only when given', async () => {
  const xml = await sitemap({ routes: [] }, {}, {
    hostname: 'https://x.com',
    entries: [
      { path: '/a', lastmod: '2026-07-31', changefreq: 'daily', priority: 0.8 },
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

test('past the cap the bare path is an index, and each sheet is a file', async () => {
  const many = Array.from({ length: 5 }, (_, i) => ({ path: `/p${i}` }));
  const config = { hostname: 'https://x.com', entries: many, limit: 2 };

  const files = await sitemapFiles({ routes: [] }, {}, config);
  assert.deepEqual([...files.keys()], ['/sitemap.xml', '/sitemap-0.xml', '/sitemap-1.xml', '/sitemap-2.xml']);

  const idx = files.get('/sitemap.xml');
  assert.match(idx, /<sitemapindex/);
  assert.deepEqual(locs(idx), [
    'https://x.com/sitemap-0.xml',
    'https://x.com/sitemap-1.xml',
    'https://x.com/sitemap-2.xml',
  ]);

  const sheet = await sitemap({ routes: [] }, {}, config, '/sitemap-1.xml');
  assert.deepEqual(locs(sheet), ['https://x.com/p2', 'https://x.com/p3']);
});

test('a sheet the index does not name is null, which the server answers with a 404', async () => {
  // The same answer a static host gives for a file the build did not write.
  const many = Array.from({ length: 5 }, (_, i) => ({ path: `/p${i}` }));
  const over = { hostname: 'https://x.com', entries: many, limit: 2 };
  assert.equal(await sitemap({ routes: [] }, {}, over, '/sitemap-3.xml'), null);

  // Under the cap there are no sheets at all.
  const under = { hostname: 'https://x.com', entries: many };
  assert.equal(await sitemap({ routes: [] }, {}, under, '/sitemap-0.xml'), null);
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
  await assert.rejects(() => sitemap(manifest, pages, {}), /"hostname" is undefined\. It is an origin/);
});

test('entries are reusable on their own, for a feed or anything else', async () => {
  const entries = await sitemapEntries(manifest, pages, {});
  assert.deepEqual(entries.map((e) => e.path), ['/', '/about', '/people/ada', '/people/grace']);
});


test('a C0 control character in a path is stripped from the sitemap', async () => {
  const xml = await sitemap(
    { routes: [{ pattern: '/p\x00age', params: [] }], gated: [] },
    {},
    { hostname: 'https://x.example' },
  );
  assert.doesNotMatch(xml, /[\x00-\x08\x0B\x0C\x0E-\x1F]/);
});

// ---- what the sitemap drill found -------------------------------------------
//
// `spec/DRILLS.md` has the drill. Each test is one input the old module and the
// rebuilt one answered differently, with the answer decided then.

test('a g flag on an exclude pattern leaves out every match, not every other one', async () => {
  const xml = await sitemap({ routes: ['/a/1', '/a/2', '/a/3', '/b'].map((p) => ({ id: p, pattern: p, params: [] })) }, {}, {
    hostname: 'https://x.com',
    exclude: [/^\/a\//g],
  });
  assert.deepEqual(locs(xml), ['https://x.com/b']);
});

test('a lastmod is the day in UTC, and one that is no date or is 0 is dropped', async () => {
  const xml = await sitemap({ routes: [] }, {}, {
    hostname: 'https://x.com',
    entries: [
      { path: '/offset', lastmod: '2026-07-31T23:30:00-05:00' },
      { path: '/number', lastmod: Date.UTC(2026, 6, 31, 12) },
      { path: '/word', lastmod: 'yesterday' },
      { path: '/zero', lastmod: 0 },
      // `new Date(true)` is a moment in 1970.
      { path: '/true', lastmod: true },
    ],
  });
  assert.match(xml, /offset<\/loc><lastmod>2026-08-01<\/lastmod>/);
  assert.match(xml, /number<\/loc><lastmod>2026-07-31<\/lastmod>/);
  assert.equal(xml.match(/<lastmod>/g).length, 2);
});

test('a priority of null is no priority, and 0 is one', async () => {
  const xml = await sitemap({ routes: [] }, {}, {
    hostname: 'https://x.com',
    entries: [{ path: '/a', priority: null }, { path: '/b', priority: 0 }],
  });
  assert.doesNotMatch(xml, /null/);
  assert.match(xml, /<priority>0<\/priority>/);
});

test('a URL is percent-encoded as well as escaped', async () => {
  const xml = await sitemap(
    { routes: [{ id: 'p', pattern: '/p/:x', params: ['x'] }] },
    { p: { paths: () => [{ x: 'a b' }, { x: 'café' }] } },
    { hostname: 'https://x.com' },
  );
  assert.deepEqual(locs(xml), ['https://x.com/p/a%20b', 'https://x.com/p/caf%C3%A9']);
});

test('an entry path that is already encoded is not encoded again', async () => {
  const xml = await sitemap({ routes: [] }, {}, { hostname: 'https://x.com', entries: [{ path: '/p/a%20b' }] });
  assert.deepEqual(locs(xml), ['https://x.com/p/a%20b']);
});

test('a route URL and an entry that names it encoded are one URL', async () => {
  const xml = await sitemap(
    { routes: [{ id: 'p', pattern: '/p/:x', params: ['x'] }] },
    { p: { paths: () => [{ x: 'a b' }] } },
    { hostname: 'https://x.com', entries: [{ path: '/p/a%20b', priority: 0.8 }] },
  );
  assert.deepEqual(locs(xml), ['https://x.com/p/a%20b']);
  assert.match(xml, /<priority>0\.8<\/priority>/);
});

test('a % that starts no escape is written as %25', async () => {
  const xml = await sitemap({ routes: [] }, {}, { hostname: 'https://x.com', entries: [{ path: '/100%' }] });
  assert.deepEqual(locs(xml), ['https://x.com/100%25']);
});

test('a param holding %, ? or # is encoded, not read as part of the URL', async () => {
  const xml = await sitemap(
    { routes: [{ id: 'p', pattern: '/p/:x', params: ['x'] }, { id: 'd', pattern: '/d/:path{.+}', params: ['path'] }] },
    { p: { paths: () => [{ x: '50%' }, { x: 'a?b#c' }] }, d: { paths: () => [{ path: 'x/y?z' }] } },
    { hostname: 'https://x.com' },
  );
  assert.deepEqual(locs(xml), ['https://x.com/p/50%25', 'https://x.com/p/a%3Fb%23c', 'https://x.com/d/x/y%3Fz']);
});

test('an empty priority and a changefreq of 0 are written as none', async () => {
  const xml = await sitemap({ routes: [] }, {}, {
    hostname: 'https://x.com',
    entries: [{ path: '/a', priority: '', changefreq: 0 }],
  });
  assert.doesNotMatch(xml, /<priority>|<changefreq>/);
});

test('a later mention that leaves a field undefined keeps the earlier value', async () => {
  const entries = await sitemapEntries({ routes: [] }, {}, {
    entries: [
      { path: '/a', lastmod: '2026-01-01', priority: 0.5 },
      { path: '/a', lastmod: undefined, priority: null },
    ],
  });
  assert.deepEqual(entries, [{ path: '/a', lastmod: '2026-01-01', priority: null }]);
});

test('paths() that gives something other than a list is refused, and named', async () => {
  await assert.rejects(
    () => sitemapEntries({ routes: [{ id: 'p', pattern: '/p/:x', params: ['x'] }] }, { p: { paths: () => ({}) } }),
    /paths\(\) in \/p\/:x gave object\. It is a list of params/,
  );
});

test('an exclude that is not a path or a pattern is refused, and named', async () => {
  // `search` would read 5 as the pattern /5/.
  for (const rule of [5, null, {}]) {
    await assert.rejects(
      () => sitemapEntries({ routes: [] }, {}, { exclude: ['/a', rule] }),
      (err) => err.message.includes(`"exclude" has ${JSON.stringify(rule)}. Each one is a path`),
    );
  }
  await assert.rejects(() => sitemapEntries({ routes: [] }, {}, { exclude: '/admin' }), /"exclude" is "\/admin"\. It is a list/);
});

test('null from paths() or entries is no URLs, the way the build reads it', async () => {
  const entries = await sitemapEntries(
    { routes: [{ id: 'p', pattern: '/p/:x', params: ['x'] }, { id: 'a', pattern: '/a', params: [] }] },
    { p: { paths: () => null } },
    { entries: () => null },
  );
  assert.deepEqual(entries.map((e) => e.path), ['/a']);
  const none = await sitemapEntries({ routes: [] }, {}, { entries: () => undefined });
  assert.deepEqual(none, []);
});

test('an entry whose path is not a path on this site is refused, and named', async () => {
  const refuse = (entry) =>
    assert.rejects(() => sitemapEntries({ routes: [] }, {}, { entries: [{ path: '/ok' }, entry] }), (err) => {
      assert.match(err.message, /sitemap entry 2 has the path/);
      assert.match(err.message, /beginning with one "\/"/);
      return true;
    });

  await refuse({ lastmod: '2026-07-31' });
  await refuse({ path: 'press' });
  await refuse({ path: '//evil.com/x' });
  await refuse({ path: 'https://evil.com/x' });
  await assert.rejects(
    () => sitemapEntries({ routes: [] }, {}, { entries: () => ({ path: '/a' }) }),
    /"entries" gave object/,
  );
});

test('a limit that is not a whole number from 1 to 50000 is refused, and named', async () => {
  for (const limit of [0, -1, 1.5, 50001, '2']) {
    await assert.rejects(
      () => sitemap({ routes: [] }, {}, { hostname: 'https://x.com', limit }),
      new RegExp(`"limit" is ${JSON.stringify(JSON.stringify(limit)).slice(1, -1)}\\. It is a whole number from 1 to 50000`),
    );
  }
  // JSON writes NaN as null, which named the wrong value.
  await assert.rejects(() => sitemap({ routes: [] }, {}, { hostname: 'https://x.com', limit: NaN }), /"limit" is NaN\./);
  assert.match(await sitemap({ routes: [] }, {}, { hostname: 'https://x.com', limit: 50000 }), /<urlset/);
});

test('a hostname that is not an origin is refused, and named', async () => {
  // A user and a password would be written into every URL.
  const refused = ['acme.com', 'https://acme.com/blog', 'https://acme.com/?a=1', 'ftp://acme.com', 'https://u:p@acme.com', 'https://u@acme.com'];
  for (const hostname of refused) {
    await assert.rejects(
      () => sitemap({ routes: [] }, {}, { hostname }),
      (err) => err.message.includes(`"hostname" is ${JSON.stringify(hostname)}. It is an origin`),
    );
  }
  assert.match(await sitemap({ routes: [] }, {}, { hostname: 'https://acme.com/' }), /<urlset/);
  assert.match(await sitemap({ routes: [] }, {}, { hostname: 'http://localhost:3000' }), /<urlset/);
});

test('the dev server reads gated, serves the sheets, and reports a failure', () => {
  // A text check, as in `context-shape.test.js`: `bin/dev.js` starts a server
  // the moment it is imported. The dev sitemap listed gated paths, had no
  // sheets, and sent a failing `paths()` to Hono's default handler.
  const source = fs
    .readFileSync(fileURLToPath(new URL('../bin/dev.js', import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  assert.match(source, /readGated\(serverModule\?\.gated\)/);
  assert.match(source, /sitemap\(\{ routes, gated \}/);
  assert.match(source, /'\/:sheet\{sitemap-\[0-9\]\+\\\\\.xml\}'/);
  assert.match(source, /onError\(c, err, \{ route: null, phase: 'sitemap' \}\)/);
});

test('a changefreq outside the protocol is refused, and named', async () => {
  // Written as given, `often` made a sitemap the schema refuses.
  for (const changefreq of ['often', 'Weekly', 5]) {
    await assert.rejects(
      () => sitemapEntries({ routes: [] }, {}, { entries: [{ path: '/a' }, { path: '/b', changefreq }] }),
      (err) => err.message.includes(`sitemap entry 2 has the changefreq ${JSON.stringify(changefreq)}. It is one of always,`),
    );
  }
});

test('a priority that is not a number from 0 to 1 is refused, and named', async () => {
  for (const [priority, shown] of [[7, '7'], [-0.1, '-0.1'], [NaN, 'NaN'], ['0.5', '"0.5"']]) {
    await assert.rejects(
      () => sitemapEntries({ routes: [] }, {}, { entries: [{ path: '/a', priority }] }),
      (err) => err.message.includes(`sitemap entry 1 has the priority ${shown}. It is a number from 0 to 1`),
    );
  }
});

test('a later null clears a field an earlier mention gave', async () => {
  const xml = await sitemap({ routes: [] }, {}, {
    hostname: 'https://x.com',
    entries: [
      { path: '/a', lastmod: '2026-07-31', priority: 0.5 },
      { path: '/a', lastmod: null, priority: null },
    ],
  });
  assert.doesNotMatch(xml, /<lastmod>|<priority>/);
});

test('a sitemap with no URLs has no blank line in it', async () => {
  const xml = await sitemap({ routes: [] }, {}, { hostname: 'https://x.com' });
  assert.match(xml, /0\.9">\n<\/urlset>\n$/);
});
