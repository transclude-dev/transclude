// What the build produced, as a list something else can cache.
//
// The framework ships no service worker. This is the same agreement fragments
// have: the server states a fact and somebody else acts on it. Workbox reads
// this format directly, and thirty lines of hand-written service worker reads it
// just as easily.
//
// No `node:` imports. The build calls it with maps it already holds, and the
// servers only ever send the string back.

/**
 * A URL and what tells a cache it changed.
 *
 * `revision: null` means the URL is the version: an asset's filename carries its
 * own hash, so the bytes behind it never change and it can be held forever.
 * Everything else keeps a stable URL and different bytes between builds, so it
 * carries its ETag instead. Getting this backwards is how a service worker
 * serves last week's page and cannot be talked out of it.
 *
 * @typedef {{ url: string, revision: string|null }} Entry
 */

/** Orders two entries by URL. */
function byUrl(a, b) {
  if (a.url < b.url) return -1;
  if (a.url > b.url) return 1;
  return 0;
}

/**
 * @param {object} sources
 * @param {Iterable<[string, { etag?: string }]>} sources.pages prerendered documents
 * @param {Iterable<[string, unknown]>} sources.assets hashed build output
 * @param {Iterable<[string, { etag?: string }]>} [sources.files] the author's public files
 * @returns {Entry[]} sorted by URL, so two builds of the same site agree
 */
export function precacheList({ pages, assets, files = [] }) {
  const entries = [];

  // An asset's name holds its hash, so it needs no revision and can be cached
  // until the name changes, which is what a new build does.
  for (const [url] of assets) entries.push({ url, revision: null });

  for (const source of [pages, files]) {
    for (const [url, entry] of source) {
      // Not `?? null`. A missing revision reads as "this URL is immutable", so a
      // page whose ETag went missing would be cached until the visitor cleared
      // it by hand. Refusing is the smaller failure.
      if (!entry.etag) {
        throw new Error(`[transclude] ${url} has no ETag, so nothing can say when it changed.`);
      }
      entries.push({ url, revision: entry.etag });
    }
  }

  // Sorted by URL so two builds of the same site write the same file. Compared
  // as code units rather than with `localeCompare`, which is locale-dependent
  // and would order the list differently on different machines.
  entries.sort(byUrl);
  return entries;
}

/**
 * The document served at `/precache.json`.
 *
 * `version` changes when any entry does, so a service worker can name its cache
 * after it and drop the old one on activate without comparing lists.
 *
 * @param {Entry[]} entries
 * @param {string} version
 * @returns {string} JSON, with a trailing newline
 */
export function precacheDocument(entries, version) {
  return `${JSON.stringify({ version, precache: entries }, null, 2)}\n`;
}

/** Where it is served, and where the build writes it under `static/`. */
export const PRECACHE_PATH = '/precache.json';
