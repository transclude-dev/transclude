// One cache for the resolution chain. Not the page cache.
//
// There are two, and keeping them apart matters. `export const revalidate` in a
// route caches a rendered page, keyed by its URL. This one caches the pieces a
// render is built from, keyed by what was asked for, because a DID document is
// read by the record view, the identity view and every embed of either. Merge
// them and the second reader pays the first reader's network cost again.
//
// A Map, not a store. On Node, Bun and Deno it lives as long as the process. On
// Workers it lives as long as the isolate, which is minutes and not guaranteed.
// That is the honest ceiling of an in-process cache, and it is enough: a miss
// costs one fetch, and the TTLs below are short enough that correctness never
// depends on a hit.

/** @typedef {import('./trace.js').CacheState} CacheState */

/**
 * How long each kind of answer stays good. Named rather than passed as numbers,
 * so the reasoning sits next to the value.
 */
export const TTL = {
  // A DID document changes when someone rotates a key or moves host. Rare, and
  // when it happens the old answer is wrong in a way that matters.
  did: 5 * 60_000,
  // A handle points at a DID until its owner changes it, which is rarer still.
  handle: 5 * 60_000,
  // A lexicon is a released schema. It changes on a version, not on a whim.
  lexicon: 60 * 60_000,
  // A record is the thing the visitor came to see. Cache it long enough to
  // absorb a page reload and no longer.
  record: 30_000,
};

/** @type {Map<string, { value: unknown, expires: number }>} */
const entries = new Map();

/**
 * Read through the cache. Returns the shape `trace.step` expects, so a cached
 * hop and a fresh one are written the same way at the call site.
 *
 * A rejected promise is never stored. A PDS that is down for one request should
 * not be down for the next five minutes as well.
 *
 * @template T
 * @param {string} key
 * @param {number} ttl  Milliseconds.
 * @param {() => Promise<T>} fn
 * @returns {Promise<{ value: T, cache: CacheState }>}
 */
export async function cached(key, ttl, fn) {
  const hit = entries.get(key);
  if (hit && hit.expires > Date.now()) {
    return { value: /** @type {T} */ (hit.value), cache: 'hit' };
  }

  const value = await fn();
  entries.set(key, { value, expires: Date.now() + ttl });

  // An unbounded map on a long-lived process is a leak. This is the whole
  // eviction policy: when it gets big, drop the oldest half. Map iterates in
  // insertion order, so the oldest are the first ones out.
  if (entries.size > 2000) {
    const half = [...entries.keys()].slice(0, 1000);
    for (const stale of half) entries.delete(stale);
  }

  return { value, cache: 'miss' };
}

/** For tests, which must not see what an earlier test left behind. */
export const clearCache = () => entries.clear();
