#!/usr/bin/env node
// Compares a module rebuilt in a drill with this repository's, on every value
// the drills have probed by hand.
//
//   node scripts/drill-probe.js no-vary-search <drill copy>
//   node scripts/drill-probe.js sitemap <drill copy>
//
// A drill is clean when the spec, the old suite and this script all pass
// against the rebuilt module (`spec/DRILLS.md`, sixth round). A value a drill
// finds that this does not hold becomes a case, and is added here too.
//
// An answer is compared as a caller meets it: the boolean `hidesParam` gives,
// the sitemap document with its newlines folded, or the first 90 characters of
// an error either one throws. The values are the drills' own, kept as they
// were probed, so some sitemap rows repeat. A header with a leading tab is not
// here: a `Headers` object strips it before the module sees it.

import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [moduleName, copy] = process.argv.slice(2);
if (!['no-vary-search', 'sitemap'].includes(moduleName) || !copy) {
  console.error('usage: node scripts/drill-probe.js <no-vary-search|sitemap> <drill copy>');
  process.exit(2);
}

const ours = await import(new URL(`../src/${moduleName}.js`, import.meta.url).href);
const theirs = await import(pathToFileURL(path.resolve(copy, 'src', `${moduleName}.js`)).href);

// ---- no-vary-search ----------------------------------------------------------

const HEADERS = [
  "",
  "   ",
  "key-order",
  "params",
  "params=?1",
  "params=?0",
  "params=()",
  "params=(\"fragment\")",
  "params=(\"a\" \"b\")",
  "params=(\"a\" \"fragment\")",
  "except=()",
  "except=(\"fragment\")",
  "except=(\"x\")",
  "params, except=(\"fragment\")",
  "params, except=()",
  "params=?0, except=()",
  "params=(\"a\"), except=(\"fragment\")",
  "except=(\"fragment\"), params",
  "except",
  "params=(utm_source)",
  "params=(\"a\");x",
  "params;x",
  "params=(\"a\")x",
  "params=(\"fragment\"), params=(\"a\")",
  "PARAMS",
  "Except=()",
  "foo=1",
  "key-order, params",
  "params=(\"a,b\" \"c\")",
  "params=(\"a\"\t\"fragment\")",
  "params=(\"fragment\" \"a\"",
  "params=(\"a\"\"fragment\")",
  "params=1",
  "except=?1",
  "key-order, except=(\"fragment\")",
  "xparams",
  "params =(\"fragment\")",
  "params=( \"fragment\" )",
  "garbage!!",
  "Params",
  "params=(\"utm\"),",
  "params=?0, except=(\"fragment\")",
  "except=?0",
  "params=(\"fr%61gment\")",
  "params=(\"fr+agment\")",
  "params=\"fragment\"",
  "key-order=5",
  "params=(\"fragment\";x)",
  "params=(fragment)",
  "foo=@123, params=(\"a\")",
  "foo=%\"%ff\", params=(\"a\")",
  "params=(\"a\"),\tkey-order",
  "params=(\"%\")",
  "unknown, params=(\"utm\")",
  "foo=1.2345",
  "foo=1.2345, params=(\"a\")",
  "utmparams=bad(",
  "PARAMS=1, x=(utm)",
  "except=(\"a\")",
  "params=tok",
  "params=5",
  "key-order=5, params",
  "params=(\"frag+ment\")",
  "params=(\"%66ragment\")",
  "params=(\"%E2%82\")",
  " ",
  "params=(\"a\");q=1.2345",
  "params=(\"a\" \"b\";x=1)",
  "params=(\t\"a\")",
  "x=:abc:, params=(\"a\")",
  "x=@1, params=(\"a\")",
  "x=%\"%e2\", params=(\"a\")",
  "params=(\"a\"), x=\"é\"",
  "params=(\"é\")",
  "params=(\"a\")\t,\tkey-order",
  " params=(\"fragment\")",
  "params=(\"fragment\") ",
  "except=(\"fragment\"), params=?1",
  "params=?1;a, except=(\"fragment\")",
  "params, params=?0",
  "except=(\"fragment\"), except=()",
  "params=(\"a\"), params",
  "paramsx",
  "params-x=?1",
  "Params=?1, params=(\"a\")",
  "params=(\"a\"),,",
  "*=1, params=(\"a\")",
  "a=?2",
  "a=-1, params=(\"a\")",
  "a=1., params=(\"a\")",
  "a=1234567890123456, params=(\"a\")",
  "key-order=1, params=(\"a\")",
  "key-order=1",
  "key-order=?0, params=(\"a\")",
  "params=(\"fragment\" 1)",
  "foo=\"x, params\", bad(",
  "foo=\"a, params\"",
  "except=(\"fr%61gment\")",
  "params=?1, except=(\"fragment\")",
  "params=?1, except=()",
  "except=(\"fragment\"), key-order",
  "except=(\"fragment\");a",
  "x=%\"%ff\", params=(\"a\")",
  "x=%\"%C3%A9\", params=(\"a\")",
  "x=@1.5, params=(\"a\")",
  "params=(\"a\")\t",
  "x=:YQ:, params=(\"a\")",
  "x=:YQ, params=(\"a\")",
  "params=(\"fr%61gment\"), except=(\"fragment\")",
  " except=()",
  "except=(), params=?0",
  "params=?1;q, except=(\"fragment\")",
  "params=(\"fragment\"), key-order=?1",
  "params=(\"frag%zz\")",
  "params=%\"fragment\"",
  "params x",
  "params x=1, bad(",
  "foo;params, bad(",
  "foo=\"unclosed, params",
  "paramsx, bad(",
  "params=(\"a\"), bad(",
  "bad(, except",
  " params =(\"a\")",
  "params\t=(\"a\")",
  "params=(\"a\" )",
  "params=( \"a\")",
  "params=(\"fragment\";x=?1)",
  "except=(\"fragment\";a)",
  "key-order;a=1, params=(\"a\")",
  "key-order=?1;a, params=(\"fragment\")",
  "params=(\"a\"),\t except=(\"fragment\")",
  "params=?1, except=(\"fragment\"), params=(\"x\")",
  "params=\"a\", except=(\"fragment\")",
  "except=(fragment)",
  "except=(\"a\" 1)",
  "params=:YQ==:",
  "params=@1",
  "params=1.5",
  "params=*tok",
  "x=(1 2), params=(\"a\")",
  "x=(1  2), params=(\"a\")",
  "x=(\"a\"  \"b\"), params=(\"a\")",
  "params=(\"a\")  ",
  "  params=(\"a\")",
  "params=(\"a\"),",
  ",params=(\"a\")",
  "params=(\"a\")\\,",
  "key-order=1, params=(\"utm_source\")",
];

function headerAnswer(module, value) {
  try {
    return String(module.hidesParam(value, 'fragment'));
  } catch (error) {
    return `THROWS ${String(error.message).slice(0, 90)}`;
  }
}

function headerRows() {
  return HEADERS.map((value) => ({
    name: JSON.stringify(value),
    ours: () => headerAnswer(ours, value),
    theirs: () => headerAnswer(theirs, value),
  }));
}

// ---- sitemap -----------------------------------------------------------------

const H = 'https://x.com';
const r = (pattern, params = []) => ({ id: pattern, pattern, params });

// Each table below is written the way its round wrote it. The first names its
// hostname in the config. The second gives it as a fifth value, `H` when left
// out, and the third always uses `H`.

const FIRST = [
  ['lastmod string date', { routes: [] }, {}, { hostname: H, entries: [{ path: '/a', lastmod: '2026-07-31' }] }],
  ['lastmod string datetime -05:00', { routes: [] }, {}, { hostname: H, entries: [{ path: '/a', lastmod: '2026-07-31T23:30:00-05:00' }] }],
  ['lastmod Date', { routes: [] }, {}, { hostname: H, entries: [{ path: '/a', lastmod: new Date('2026-07-31T12:00:00Z') }] }],
  ['lastmod "yesterday"', { routes: [] }, {}, { hostname: H, entries: [{ path: '/a', lastmod: 'yesterday' }] }],
  ['lastmod 0', { routes: [] }, {}, { hostname: H, entries: [{ path: '/a', lastmod: 0 }] }],
  ['lastmod ms number', { routes: [] }, {}, { hostname: H, entries: [{ path: '/a', lastmod: 1785499200000 }] }],
  ['priority 0', { routes: [] }, {}, { hostname: H, entries: [{ path: '/a', priority: 0 }] }],
  ['priority null', { routes: [] }, {}, { hostname: H, entries: [{ path: '/a', priority: null }] }],
  ['param with space', { routes: [r('/p/:x', ['x'])] }, { '/p/:x': { paths: () => [{ x: 'a b' }] } }, { hostname: H }],
  ['param café', { routes: [r('/p/:x', ['x'])] }, { '/p/:x': { paths: () => [{ x: 'café' }] } }, { hostname: H }],
  ['paths() null', { routes: [r('/p/:x', ['x'])] }, { '/p/:x': { paths: () => null } }, { hostname: H }],
  ['hostname with base path', { routes: [r('/a')] }, {}, { hostname: 'https://x.com/blog' }],
  ['hostname trailing slash', { routes: [r('/a')] }, {}, { hostname: 'https://x.com/' }],
  ['hostname no scheme', { routes: [r('/a')] }, {}, { hostname: 'x.com' }],
  ['entry relative path', { routes: [] }, {}, { hostname: H, entries: [{ path: 'press' }] }],
  ['entry absolute other host', { routes: [] }, {}, { hostname: H, entries: [{ path: 'https://evil.com/x' }] }],
  ['entry no path', { routes: [] }, {}, { hostname: H, entries: [{ lastmod: '2026-01-01' }] }],
  ['entries fn returns null', { routes: [r('/a')] }, {}, { hostname: H, entries: () => null }],
  ['exclude /g regex', { routes: [r('/a/1'), r('/a/2'), r('/a/3'), r('/b')] }, {}, { hostname: H, exclude: [/^\/a\//g] }],
  ['limit 0', { routes: [r('/a')] }, {}, { hostname: H, limit: 0 }],
  ['limit 100000', { routes: [r('/a')] }, {}, { hostname: H, limit: 100000 }],
  ['limit 1.5', { routes: [r('/a'), r('/b')] }, {}, { hostname: H, limit: 1.5 }],
  ['over cap index, base path host', { routes: [r('/a'), r('/b'), r('/c')] }, {}, { hostname: 'https://x.com/blog', limit: 2 }],
  ['merge: later undefined lastmod', { routes: [] }, {}, { hostname: H, entries: [{ path: '/a', lastmod: '2026-01-01' }, { path: '/a', lastmod: undefined }] }],
  ['entries fn returns undefined', { routes: [r('/a')] }, {}, { hostname: H, entries: () => undefined }],
  ['entries not an array', { routes: [r('/a')] }, {}, { hostname: H, entries: { path: '/a' } }],
  ['entry null', { routes: [] }, {}, { hostname: H, entries: [null] }],
  ['hostname missing', { routes: [r('/a')] }, {}, {}],
  ['hostname upper case', { routes: [r('/a')] }, {}, { hostname: 'https://X.COM' }],
  ['hostname with user', { routes: [r('/a')] }, {}, { hostname: 'https://u:p@x.com' }],
  ['hostname ftp', { routes: [r('/a')] }, {}, { hostname: 'ftp://x.com' }],
  ['hostname query', { routes: [r('/a')] }, {}, { hostname: 'https://x.com?a=1' }],
  ['hostname not a string', { routes: [r('/a')] }, {}, { hostname: 5 }],
  ['exclude string exact', { routes: [r('/admin'), r('/admin/x'), r('/b')] }, {}, { hostname: H, exclude: ['/admin'] }],
  ['exclude regex partial', { routes: [r('/admin'), r('/xadmin'), r('/b')] }, {}, { hostname: H, exclude: [/admin/] }],
  ['exclude bad pattern', { routes: [r('/a')] }, {}, { hostname: H, exclude: [5] }],
  ['exclude bad pattern, empty', { routes: [] }, {}, { hostname: H, exclude: [5] }],
  ['entry already encoded', { routes: [] }, {}, { hostname: H, entries: [{ path: '/p/a%20b' }] }],
  ['entry query and amp', { routes: [] }, {}, { hostname: H, entries: [{ path: '/s?q=1&b=2' }] }],
  ['entry hash', { routes: [] }, {}, { hostname: H, entries: [{ path: '/s#x' }] }],
  ['entry quote', { routes: [] }, {}, { hostname: H, entries: [{ path: "/it's" }] }],
  ['changefreq empty', { routes: [] }, {}, { hostname: H, entries: [{ path: '/a', changefreq: '' }] }],
  ['changefreq often, priority 7', { routes: [] }, {}, { hostname: H, entries: [{ path: '/a', changefreq: 'often', priority: 7 }] }],
  ['priority string', { routes: [] }, {}, { hostname: H, entries: [{ path: '/a', priority: '0.5' }] }],
  ['merge null clears', { routes: [] }, {}, { hostname: H, entries: [{ path: '/a', priority: 0.5 }, { path: '/a', priority: null }] }],
  ['order: entries after routes, merged stays', { routes: [r('/a'), r('/b')] }, {}, { hostname: H, entries: [{ path: '/z' }, { path: '/a', priority: 1 }] }],
  ['lastmod non-ISO string', { routes: [] }, {}, { hostname: H, entries: [{ path: '/a', lastmod: 'July 31, 2026' }] }],
  ['lastmod object', { routes: [] }, {}, { hostname: H, entries: [{ path: '/a', lastmod: {} }] }],
  ['lastmod true', { routes: [] }, {}, { hostname: H, entries: [{ path: '/a', lastmod: true }] }],
  ['limit "10"', { routes: [r('/a')] }, {}, { hostname: H, limit: '10' }],
  ['limit 50000', { routes: [r('/a')] }, {}, { hostname: H, limit: 50000 }],
  ['limit NaN', { routes: [r('/a')] }, {}, { hostname: H, limit: NaN }],
  ['limit null', { routes: [r('/a')] }, {}, { hostname: H, limit: null }],
  ['over cap, index', { routes: [r('/a'), r('/b'), r('/c')] }, {}, { hostname: H, limit: 2 }],
  ['over cap, sheet 0', { routes: [r('/a'), r('/b'), r('/c')] }, {}, { hostname: H, limit: 2 }, '/sitemap-0.xml'],
  ['over cap, sheet 1', { routes: [r('/a'), r('/b'), r('/c')] }, {}, { hostname: H, limit: 2 }, '/sitemap-1.xml'],
  ['over cap, sheet 2', { routes: [r('/a'), r('/b'), r('/c')] }, {}, { hostname: H, limit: 2 }, '/sitemap-2.xml'],
  ['under cap, sheet 0', { routes: [r('/a')] }, {}, { hostname: H }, '/sitemap-0.xml'],
  ['exactly at cap', { routes: [r('/a'), r('/b')] }, {}, { hostname: H, limit: 2 }],
  ['zero urls', { routes: [] }, {}, { hostname: H }],
  ['catch-all slash', { routes: [r('/docs/*', ['path'])] }, { '/docs/*': { paths: () => [{ path: 'x/y z' }] } }, { hostname: H }],
  ['paths() not array', { routes: [r('/p/:x', ['x'])] }, { '/p/:x': { paths: () => ({}) } }, { hostname: H }],
  ['route and entry merge with space', { routes: [r('/p/:x', ['x'])] }, { '/p/:x': { paths: () => [{ x: 'a b' }] } }, { hostname: H, entries: [{ path: '/p/a b', priority: 1 }] }],
  ['merge null clears lastmod', { routes: [] }, {}, { hostname: H, entries: [{ path: '/x', lastmod: '2026-07-31' }, { path: '/x', lastmod: null }] }],
  ['route space and encoded entry merge', { routes: [r('/p/:x', ['x'])] }, { '/p/:x': { paths: () => [{ x: 'a b' }] } }, { hostname: H, entries: [{ path: '/p/a%20b', priority: 1 }] }],
  ['entry 100%', { routes: [] }, {}, { hostname: H, entries: [{ path: '/100%' }] }],
  ['param with hash and query', { routes: [r('/docs/*', ['path'])] }, { '/docs/*': { paths: () => [{ path: 'c#d?e' }] } }, { hostname: H }],
  ['hostname upper with port', { routes: [r('/a')] }, {}, { hostname: 'HTTPS://ACME.com:443' }],
  ['hostname missing message', { routes: [r('/a')] }, {}, { hostname: undefined }],
  ['limit "5"', { routes: [r('/a')] }, {}, { hostname: H, limit: '5' }],
  ['exclude string no slash', { routes: [r('/a')] }, {}, { hostname: H, exclude: ['a'] }],
  ['gated entry', { routes: [], gated: ['/secret'] }, {}, { hostname: H, entries: [{ path: '/secret' }] }],
  ['changefreq 0', { routes: [] }, {}, { hostname: H, entries: [{ path: '/a', changefreq: 0 }] }],
  ['priority empty string', { routes: [] }, {}, { hostname: H, entries: [{ path: '/a', priority: '' }] }],
  ['lastmod empty string', { routes: [] }, {}, { hostname: H, entries: [{ path: '/a', lastmod: '' }] }],
  ['entries fn throws', { routes: [] }, {}, { hostname: H, entries: () => { throw new Error('boom'); } }],
  ['entries {} array-ish', { routes: [] }, {}, { hostname: H, entries: {} }],
  ['many sheets order', { routes: [r('/a'), r('/b'), r('/c'), r('/d'), r('/e')] }, {}, { hostname: H, limit: 2 }, '/sitemap-2.xml'],
  ['exclude matches encoded only', { routes: [r('/p/:x', ['x'])] }, { '/p/:x': { paths: () => [{ x: 'a b' }] } }, { hostname: H, exclude: ['/p/a%20b'] }],
];

const TWO_ROUTES = { routes: [r('/p/:x', ['x']), r('/d/:rest{.+}', ['rest'])] };
const twoRoutePages = (xs, rests = []) => ({
  '/p/:x': { paths: () => xs.map((x) => ({ x })) },
  '/d/:rest{.+}': { paths: () => rests.map((rest) => ({ rest })) },
});

const SECOND = [
  ['param with slash', TWO_ROUTES, twoRoutePages(['a/b']), {}],
  ['rest with space', TWO_ROUTES, twoRoutePages([], ['x/y z']), {}],
  ['exclude raw space', TWO_ROUTES, twoRoutePages(['a b']), { exclude: ['/p/a b'] }],
  ['exclude encoded', TWO_ROUTES, twoRoutePages(['a b']), { exclude: ['/p/a%20b'] }],
  ['regex on é', TWO_ROUTES, twoRoutePages(['é']), { exclude: [/é/] }],
  ['regex on %C3', TWO_ROUTES, twoRoutePages(['é']), { exclude: [/%C3/] }],
  ['entry exclude raw', { routes: [] }, {}, { entries: [{ path: '/a b' }], exclude: ['/a b'] }],
  ['entry ctrl path', { routes: [] }, {}, { entries: [{ path: '/a\x01b' }] }],
  ['lone surrogate', { routes: [] }, {}, { entries: [{ path: '/a\uD800' }] }],
  ['later bad lastmod', { routes: [] }, {}, { entries: [{ path: '/a', lastmod: '2026-07-31' }, { path: '/a', lastmod: 'nope' }] }],
  ['gated entry', { routes: [], gated: ['/g'] }, {}, { entries: [{ path: '/g' }] }],
  ['hostname port', { routes: [] }, {}, { entries: [{ path: '/a' }] }, 'https://ACME.com:8080/'],
  ['priority 1e-7', { routes: [] }, {}, { entries: [{ path: '/a', priority: 1e-7 }] }],
  ['changefreq false', { routes: [] }, {}, { entries: [{ path: '/a', changefreq: false }] }],
  ['priority false', { routes: [] }, {}, { entries: [{ path: '/a', priority: false }] }],
  ['exclude regex ?', { routes: [] }, {}, { entries: [{ path: '/s?x=1' }], exclude: [/\?/] }],
];

const oneRoute = (xs) => [{ routes: [r('/p/:x', ['x'])] }, { '/p/:x': { paths: () => xs.map((x) => ({ x })) } }];
const noRoutes = (gated) => [{ routes: [], gated }, {}];

const THIRD = [
  ['gate entry encoded', ...noRoutes(['/p/a b']), { entries: [{ path: '/p/a%20b' }] }],
  ['gate entry raw', ...noRoutes(['/p/a%20b']), { entries: [{ path: '/p/a b' }] }],
  ['gate route space', { routes: [r('/p/:x', ['x'])], gated: ['/p/a b'] }, { '/p/:x': { paths: () => [{ x: 'a b' }] } }, {}],
  ['gate route slash', { routes: [r('/p/:x', ['x'])], gated: ['/p/a/*'] }, { '/p/:x': { paths: () => [{ x: 'a/b' }] } }, {}],
  ['gate route 50%', { routes: [r('/p/:x', ['x'])], gated: ['/p/50%'] }, { '/p/:x': { paths: () => [{ x: '50%' }] } }, {}],
  ['year 10000', ...noRoutes(), { entries: [{ path: '/a', lastmod: '+010000-01-01T00:00:00Z' }] }],
  ['entry hash', ...noRoutes(), { entries: [{ path: '/a#b' }] }],
  ['exclude with query', ...noRoutes(), { entries: [{ path: '/s?q=1' }], exclude: ['/s?q=1'] }],
  ['exclude lower hex', ...oneRoute(['café']), { exclude: ['/p/caf%c3%a9'] }],
  ['entry lower hex merges', ...oneRoute(['café']), { entries: [{ path: '/p/caf%c3%a9', priority: 0.5 }] }],
  ['priority 1e-7', ...noRoutes(), { entries: [{ path: '/a', priority: 1e-7 }] }],
  ['param plus', ...oneRoute(['a+b']), {}],
  ['param amp', ...oneRoute(['a&b']), {}],
  ['entry amp', ...noRoutes(), { entries: [{ path: '/a&b' }] }],
  ['entry [] chars', ...noRoutes(), { entries: [{ path: '/a[b]' }] }],
  ['entry non-object', ...noRoutes(), { entries: ['/x'] }],
  ['changefreq with ctrl', ...noRoutes(), { entries: [{ path: '/a', changefreq: 'dai\x01ly' }] }],
  ['lastmod no offset', ...noRoutes(), { entries: [{ path: '/a', lastmod: '2026-07-31T23:30' }] }],
  ['paths null element', oneRoute([])[0], { '/p/:x': { paths: () => [null] } }, {}],
];

async function sitemapAnswer(module, manifest, pages, config, file) {
  try {
    const xml = await module.sitemap(manifest, pages, config, file);
    return String(xml).replace(/<\?xml[^>]*>\n/, '').replace(/ xmlns="[^"]*"/, '').replace(/\n/g, ' ');
  } catch (error) {
    return `THROWS ${String(error.message).slice(0, 90)}`;
  }
}

function sitemapRow(name, manifest, pages, config, file = '/sitemap.xml') {
  return {
    name,
    ours: () => sitemapAnswer(ours, manifest, pages, config, file),
    theirs: () => sitemapAnswer(theirs, manifest, pages, config, file),
  };
}

function sitemapRows() {
  const rows = [];
  for (const [name, manifest, pages, config, file] of FIRST) rows.push(sitemapRow(name, manifest, pages, config, file));
  for (const [name, manifest, pages, config, host = H] of SECOND) {
    rows.push(sitemapRow(name, manifest, pages, { hostname: host, ...config }));
  }
  for (const [name, manifest, pages, config] of THIRD) rows.push(sitemapRow(name, manifest, pages, { hostname: H, ...config }));
  return rows;
}

// ---- the comparison ----------------------------------------------------------

const rows = moduleName === 'sitemap' ? sitemapRows() : headerRows();
let agree = 0;

for (const row of rows) {
  const a = await row.ours();
  const b = await row.theirs();
  if (a === b) {
    agree++;
    continue;
  }
  console.log(`${row.name}\n  main:    ${a}\n  rebuilt: ${b}`);
}

console.log(`${agree} of ${rows.length} agree`);
process.exitCode = agree === rows.length ? 0 : 1;
