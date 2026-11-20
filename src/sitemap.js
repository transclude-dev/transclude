// GET /sitemap.xml, from the route table the framework already has.
//
// A page route with no parameters is one URL. A parameter route is as many as
// its `paths` export names, which is the same list the build prerenders, so a
// route that ships as files is listed without the author repeating it. Anything
// else (a route with no `paths`, an endpoint, an error page) is not a page a
// crawler can reach by guessing, so it is left out.
//
// Past `limit` URLs the list is cut into sheets, each a file of its own at
// `/sitemap-0.xml`, `/sitemap-1.xml` and on, and `/sitemap.xml` is the index of
// them. Files and not `?p=`: the build writes the same files into
// `dist/static`, and a static host ignores a query, so `?p=1` would have been
// the index again.

import { urlFor } from './document.js';
import { isGated } from './gate.js';

/** The protocol's cap for one file. Past it the response is an index of files. */
const LIMIT = 50000;

// C0 controls other than tab, newline and return cannot appear in XML 1.0 at
// all: a single one from a path or a changefreq an app built from its own data
// would make the sitemap unparseable. Dropped, since none stands for anything.
const xmlSafe = (text) => String(text).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

const escape = (text) =>
  xmlSafe(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/**
 * `2026-07-31`, which is what a sitemap wants and what a Date will not give.
 *
 * A string, a number or a Date. `new Date(true)` is a moment in 1970, so
 * anything else is no date.
 */
function day(value) {
  if (!value) return null;
  if (typeof value !== 'string' && typeof value !== 'number' && !(value instanceof Date)) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

// `search` and not `test`. A pattern with the `g` flag keeps its place between
// calls to `test`, so `/^\/draft\//g` left out `/draft/a`, kept `/draft/b`
// and left out `/draft/c`. `search` starts at the beginning every time.
const excluded = (path, rules) =>
  rules.some((rule) => (rule instanceof RegExp ? path.search(rule) !== -1 : rule === path));

/**
 * `exclude`, checked. Anything but a path or a pattern is refused: `search`
 * reads `5` as the pattern `/5/`, which leaves out every path with a 5 in it.
 *
 * @param {unknown} rules
 * @returns {Array<string|RegExp>}
 */
function checkExclude(rules) {
  if (!Array.isArray(rules)) {
    throw new Error(
      `[transclude] sitemap "exclude" is ${JSON.stringify(rules)}. It is a list of paths, ` +
        `like '/admin', and patterns, like /^\\/draft\\//.`,
    );
  }

  for (const rule of rules) {
    if (typeof rule === 'string' || rule instanceof RegExp) continue;
    throw new Error(
      `[transclude] sitemap "exclude" has ${JSON.stringify(rule)}. Each one is a path, ` +
        `like '/admin', or a pattern, like /^\\/draft\\//.`,
    );
  }

  return rules;
}

/**
 * Whether a hostname is an origin and nothing more.
 *
 * Every path is joined to it, so a path on it would be lost: `/a` on
 * `https://acme.com/blog` is `https://acme.com/a`. And `acme.com` alone is
 * not a URL.
 *
 * @param {string} hostname
 */
function isOrigin(hostname) {
  let url;
  try {
    url = new URL(hostname);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  // A user and a password would be written into every URL.
  if (url.username !== '' || url.password !== '') return false;
  return url.pathname === '/' && url.search === '' && url.hash === '';
}

/** @param {SitemapConfig['hostname']} hostname */
function readHostname(hostname) {
  if (!hostname) throw new Error('[transclude] sitemap needs a hostname');
  if (isOrigin(hostname)) return hostname;
  throw new Error(
    `[transclude] sitemap "hostname" is ${JSON.stringify(hostname)}. It is an origin ` +
      `like 'https://acme.com', with a scheme and no path, because every URL is joined to it.`,
  );
}

/**
 * URLs per sheet.
 *
 * Refused outside 1 to 50000 rather than bent into range. Zero would be
 * endless sheets, and past 50000 a sheet is a file no crawler reads.
 *
 * @param {SitemapConfig['limit']} limit
 */
function readLimit(limit) {
  if (limit === undefined) return LIMIT;
  if (Number.isInteger(limit) && limit >= 1 && limit <= LIMIT) return limit;
  // `String` for a number, because JSON writes `NaN` and `Infinity` as `null`.
  const shown = typeof limit === 'number' ? String(limit) : JSON.stringify(limit);
  throw new Error(
    `[transclude] sitemap "limit" is ${shown}. It is a whole number ` +
      `from 1 to ${LIMIT}, the URLs one sheet holds.`,
  );
}

/**
 * What `entries` gave, checked.
 *
 * `null` is no entries, the way `null` from `paths()` is no URLs. An entry
 * whose path does not begin with one `/` is refused, because it would be
 * joined somewhere else: with no path it was listed as `/undefined`, and
 * `//evil.com/x` or `https://evil.com/x` is a URL on another host, which a
 * crawler ignores.
 *
 * @param {unknown} list
 * @returns {object[]}
 */
function checkEntries(list) {
  if (list === null || list === undefined) return [];

  if (!Array.isArray(list)) {
    throw new Error(
      `[transclude] sitemap "entries" gave ${typeof list}. It is a list like ` +
        `[{ path: '/press' }], or a function that returns one.`,
    );
  }

  list.forEach((entry, index) => {
    const path = entry?.path;
    if (typeof path === 'string' && path.startsWith('/') && !path.startsWith('//')) return;
    throw new Error(
      `[transclude] sitemap entry ${index + 1} has the path ${JSON.stringify(path)}. ` +
        `It is a path on this site, beginning with one "/", like '/press'.`,
    );
  });

  return list;
}

/**
 * What a parameter route's `paths()` gave, checked. `null` is no URLs, the
 * way the build reads it.
 *
 * @param {{ pattern: string, rel?: string }} route named by its file where the
 *   manifest has one, and by its pattern where it does not
 * @param {unknown} list
 * @returns {Record<string, string>[]}
 */
function checkPaths(route, list) {
  if (list === null || list === undefined) return [];
  if (Array.isArray(list)) return list;
  throw new Error(
    `[transclude] paths() in ${route.rel ?? route.pattern} gave ${typeof list}. It is a list of params, ` +
      `like [{ slug: 'first' }].`,
  );
}

/**
 * A param value as it goes into a URL. `%`, `?` and `#` are part of the value,
 * not of the URL, so `50%` is `50%25` and `a?b#c` is `a%3Fb%23c`. Left as they
 * were, the first is no URL and the second is another one. The rest is encoded
 * when the path is joined to the hostname.
 *
 * @param {Record<string, unknown>} params
 * @returns {Record<string, string>}
 */
function paramsForUrl(params) {
  const encoded = {};
  for (const [name, value] of Object.entries(params)) {
    encoded[name] = String(value ?? '')
      .replaceAll('%', '%25')
      .replaceAll('?', '%3F')
      .replaceAll('#', '%23');
  }
  return encoded;
}

/**
 * A path as the `loc` writes it, which is also the key two mentions of one URL
 * share: `/p/a b` from a route and `/p/a%20b` from an entry are one URL, and
 * were listed twice. A `%` that starts no escape is a `%`, so `/100%` is
 * `/100%25`.
 *
 * @param {string} path
 * @returns {string}
 */
function encodedPath(path) {
  const url = new URL(path.replace(/%(?![0-9A-Fa-f]{2})/g, '%25'), 'http://x');
  return url.pathname + url.search + url.hash;
}

/**
 * Two mentions of one path as one entry. A field the later one leaves
 * `undefined` keeps the earlier value: `{ lastmod: undefined }` says nothing
 * about the date.
 *
 * @param {object} first
 * @param {object} later
 */
function merge(first, later) {
  const fields = { ...first };
  for (const [key, value] of Object.entries(later)) {
    if (value !== undefined) fields[key] = value;
  }
  return fields;
}

/**
 * Every URL the sitemap lists, in route order.
 *
 * `paths()` is the page's own, the one the build calls, so the two cannot
 * disagree about which URLs exist.
 *
 * A path named twice is one entry, carrying the fields of every mention. That
 * is how a page built from `paths()` gets a `lastmod`: the route table knows
 * the URL and nothing else, and `entries` names the same URL with the date.
 *
 * @param {Pick<import('./routes.js').Manifest, 'routes'|'gated'>} manifest the
 *   two fields read here. The dev server has no endpoint list to give, and
 *   nothing here would read one.
 * @param {Record<string, import('./document.js').PageModule>} pages
 * @param {SitemapConfig} [config]
 * @returns {Promise<Array<{ path: string, lastmod?: string }>>}
 */
export async function sitemapEntries(manifest, pages, { entries = [], exclude = [] } = {}) {
  const rules = checkExclude(exclude);
  const found = [];

  for (const route of manifest.routes ?? []) {
    const page = pages[route.id];

    if (!route.params.length) {
      found.push({ path: route.pattern });
      continue;
    }

    // A parameter route with no `paths` is server-rendered for URLs nobody has
    // listed. Advertising the pattern would advertise `/people/:name`.
    if (typeof page?.paths !== 'function') continue;

    for (const params of checkPaths(route, await page.paths())) {
      found.push({ path: urlFor(route, paramsForUrl(params)) });
    }
  }

  const extra = checkEntries(typeof entries === 'function' ? await entries() : entries);
  const all = [...found, ...extra];

  // `manifest.gated` rather than a second config key. A path the app declared
  // not public should not be advertised, and reading it here covers the file the
  // build writes and the `/sitemap.xml` route together. Two lists is two answers
  // about which URLs a crawler is invited to.
  const gated = manifest.gated ?? [];

  // One entry per path, where the path was first named. A later mention of the
  // same path is merged onto it rather than dropped, because the two mentions
  // carry different things: a route contributes the URL, and the `entries` copy
  // of that URL contributes the date. Later fields win, except `undefined`.
  const byPath = new Map();

  for (const entry of all) {
    if (excluded(entry.path, rules)) continue;
    if (isGated(entry.path, gated)) continue;

    const path = encodedPath(entry.path);
    const first = byPath.get(path);
    byPath.set(path, { ...(first ? merge(first, entry) : entry), path });
  }

  return [...byPath.values()];
}

function urlset(entries, hostname) {
  const body = entries
    .map(({ path, lastmod, changefreq, priority }) => {
      const parts = [`<loc>${escape(new URL(path, hostname).href)}</loc>`];
      const when = day(lastmod);
      if (when) parts.push(`<lastmod>${when}</lastmod>`);
      if (changefreq) parts.push(`<changefreq>${escape(changefreq)}</changefreq>`);
      // `0` is a priority. `null` and `''` are none: an empty element is not one.
      if (priority !== undefined && priority !== null && priority !== '') parts.push(`<priority>${escape(priority)}</priority>`);
      return `<url>${parts.join('')}</url>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

/** Where sheet `n` is served, and where the build writes it. */
const sheetPath = (n) => `/sitemap-${n}.xml`;

function index(sheets, hostname) {
  const body = Array.from({ length: sheets }, (_, n) => {
    const href = new URL(sheetPath(n), hostname).href;
    return `<sitemap><loc>${escape(href)}</loc></sitemap>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</sitemapindex>\n`;
}

/**
 * The `sitemap` block of a config.
 *
 * @typedef {object} SitemapConfig
 * @property {string} [hostname] every URL is absolute, so this is required. An
 *   origin, like `https://acme.com`, with no path
 * @property {number} [limit] URLs per sheet, past which an index is written. A
 *   whole number from 1 to 50000
 * @property {object[]|(() => object[]|Promise<object[]>)} [entries] URLs the
 *   route table cannot know, each with a `path` beginning with `/`. A function,
 *   so an app builds them from its own data rather than listing them.
 * @property {Array<string|RegExp>} [exclude] a path to leave out, or a pattern
 *   the path has to match. Tested against the path, not the absolute URL.
 */

/**
 * Every file the sitemap is, by the path it is served at.
 *
 * Under the cap that is `/sitemap.xml` alone. Past it, `/sitemap.xml` is the
 * index and each sheet is its own file. The build writes every one, and the
 * server answers the same paths from the same list, so a static host and the
 * server cannot disagree about which sheets exist.
 *
 * Every sheet is built for any one request. The cost is the string work on
 * the list `paths()` already gave, which is small beside `paths()` itself.
 *
 * @param {Pick<import('./routes.js').Manifest, 'routes'|'gated'>} manifest the
 *   two fields read here. The dev server has no endpoint list to give, and
 *   nothing here would read one.
 * @param {Record<string, import('./document.js').PageModule>} pages
 * @param {SitemapConfig} config the `sitemap` block, which has to name a hostname
 * @returns {Promise<Map<string, string>>} each path, like `/sitemap-0.xml`, to its XML
 */
export async function sitemapFiles(manifest, pages, config) {
  const hostname = readHostname(config.hostname);
  const limit = readLimit(config.limit);
  const entries = await sitemapEntries(manifest, pages, config);

  if (entries.length <= limit) return new Map([['/sitemap.xml', urlset(entries, hostname)]]);

  const sheets = Math.ceil(entries.length / limit);
  const files = new Map([['/sitemap.xml', index(sheets, hostname)]]);
  for (let n = 0; n < sheets; n++) {
    const from = n * limit;
    files.set(sheetPath(n), urlset(entries.slice(from, from + limit), hostname));
  }
  return files;
}

/**
 * The document for one request.
 *
 * @param {Pick<import('./routes.js').Manifest, 'routes'|'gated'>} manifest the
 *   two fields read here. The dev server has no endpoint list to give, and
 *   nothing here would read one.
 * @param {Record<string, import('./document.js').PageModule>} pages
 * @param {SitemapConfig} config the `sitemap` block, which has to name a hostname
 * @param {string} [file] the path asked for, `/sitemap.xml` or a sheet
 * @returns {Promise<string|null>} an XML document, or null for a sheet that is
 *   not one of the files, which the server answers with a 404
 */
export async function sitemap(manifest, pages, config, file = '/sitemap.xml') {
  const files = await sitemapFiles(manifest, pages, config);
  return files.get(file) ?? null;
}
