// GET /sitemap.xml, from the route table the framework already has.
//
// A page route with no parameters is one URL. A parameter route is as many as
// its `paths` export names, which is the same list the build prerenders, so a
// route that ships as files is listed without the author repeating it. Anything
// else (a route with no `paths`, an endpoint, an error page) is not a page a
// crawler can reach by guessing, so it is left out.

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

/** `2026-07-31`, which is what a sitemap wants and what a Date will not give. */
function day(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

const excluded = (path, rules) =>
  rules.some((rule) => (rule instanceof RegExp ? rule.test(path) : rule === path));

/**
 * Every URL the sitemap lists, in route order.
 *
 * `paths()` is the page's own, the one the build calls, so the two cannot
 * disagree about which URLs exist.
 *
 * @param {Pick<import('./routes.js').Manifest, 'routes'|'gated'>} manifest the
 *   two fields read here. The dev server has no endpoint list to give, and
 *   nothing here would read one.
 * @param {Record<string, import('./document.js').PageModule>} pages
 * @param {SitemapConfig} [config]
 * @returns {Promise<Array<{ path: string, lastmod?: string }>>}
 */
export async function sitemapEntries(manifest, pages, { entries = [], exclude = [] } = {}) {
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

    for (const params of (await page.paths()) ?? []) {
      found.push({ path: urlFor(route, params) });
    }
  }

  const extra = typeof entries === 'function' ? ((await entries()) ?? []) : entries;
  const all = [...found, ...extra];

  // `manifest.gated` rather than a second config key. A path the app declared
  // not public should not be advertised, and reading it here covers the file the
  // build writes and the `/sitemap.xml` route together. Two lists is two answers
  // about which URLs a crawler is invited to.
  const gated = manifest.gated ?? [];

  const seen = new Set();
  return all.filter((entry) => {
    if (seen.has(entry.path) || excluded(entry.path, exclude)) return false;
    if (isGated(entry.path, gated)) return false;
    seen.add(entry.path);
    return true;
  });
}

function urlset(entries, hostname) {
  const body = entries
    .map(({ path, lastmod, changefreq, priority }) => {
      const parts = [`<loc>${escape(new URL(path, hostname).href)}</loc>`];
      const when = day(lastmod);
      if (when) parts.push(`<lastmod>${when}</lastmod>`);
      if (changefreq) parts.push(`<changefreq>${escape(changefreq)}</changefreq>`);
      if (priority !== undefined) parts.push(`<priority>${escape(priority)}</priority>`);
      return `<url>${parts.join('')}</url>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

function index(count, hostname, limit) {
  const pages = Math.ceil(count / limit);
  const body = Array.from({ length: pages }, (_, i) => {
    const href = new URL(`/sitemap.xml?p=${i}`, hostname).href;
    return `<sitemap><loc>${escape(href)}</loc></sitemap>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</sitemapindex>\n`;
}

/**
 * The `sitemap` block of a config.
 *
 * @typedef {object} SitemapConfig
 * @property {string} [hostname] every URL is absolute, so this is required
 * @property {number} [limit] URLs per sheet, past which an index is written
 * @property {object[]|(() => object[]|Promise<object[]>)} [entries] URLs the
 *   route table cannot know. A function, so an app builds them from its own
 *   data rather than listing them.
 * @property {string[]} [exclude]
 */

/**
 * The document for one request.
 *
 * Past the cap the bare path answers with an index and `?p=` answers with a
 * slice, because a file over 50000 URLs is not a sitemap a crawler will read.
 *
 * @param {Pick<import('./routes.js').Manifest, 'routes'|'gated'>} manifest the
 *   two fields read here. The dev server has no endpoint list to give, and
 *   nothing here would read one.
 * @param {Record<string, import('./document.js').PageModule>} pages
 * @param {SitemapConfig} config the `sitemap` block, which has to name a hostname
 * @param {string|number|null} [page] which sheet, when there are more URLs than
 *   one holds. A string, because it arrives as `?p=`, and `Number` reads it.
 * @returns {Promise<string>} an XML document
 */
export async function sitemap(manifest, pages, config, page = null) {
  const { hostname, limit = LIMIT } = config;
  if (!hostname) throw new Error('[transclude] sitemap needs a hostname');

  const entries = await sitemapEntries(manifest, pages, config);

  if (entries.length <= limit) return urlset(entries, hostname);
  if (page === null) return index(entries.length, hostname, limit);

  const from = Number(page) * limit;
  return urlset(entries.slice(from, from + limit), hostname);
}
