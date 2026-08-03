// Revalidation: a rendered page held for a while, and refreshed without a build.
//
// Between the two things a route could be before: a file written once, or a
// render on every request. `export const revalidate = 3600` is the middle.
//
// Within the window a request is answered from the store and the loader does not
// run. Past it the *stale* page goes out immediately and a fresh one is rendered
// behind it, so nobody waits for a re-render. That is the whole point: the cost
// of being out of date is bounded, and no visitor pays it.

/**
 * What a page means by `export const revalidate`, in milliseconds.
 *
 * @param {object|null|undefined} page a compiled page module
 * @returns {number} 0 for a page that is rendered every time
 */
export function windowOf(page) {
  const value = page?.revalidate;
  if (value === undefined || value === null || value === false) return null;

  const seconds = typeof value === 'number' ? value : value.seconds;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
    throw new Error(
      `[transclude] revalidate must be a number of seconds, or { seconds, tags }, not ` +
        `${JSON.stringify(value)}`,
    );
  }

  return { seconds, tags: (typeof value === 'object' && value.tags) || [] };
}

/**
 * The default store: a bounded map, right for one server.
 *
 * Bounded because the key carries the query string, so a route reading `?q=`
 * has as many entries as there are searches. Oldest out first, which is not
 * least-recently-used and is enough: an entry that matters is rewritten by its
 * own revalidation and moves back to the end.
 *
 * @param {{ max?: number }} [options]
 * @returns {{ get: Function, set: Function, delete: Function, clear: Function, size: () => number }}
 */
export function memoryStore({ max = 1000 } = {}) {
  const entries = new Map();

  return {
    get: (key) => entries.get(key),

    set(key, entry) {
      entries.delete(key);
      entries.set(key, entry);
      while (entries.size > max) entries.delete(entries.keys().next().value);
    },

    delete: (key) => void entries.delete(key),

    deleteByTag(tag) {
      for (const [key, entry] of entries) {
        if (entry.tags?.includes(tag)) entries.delete(key);
      }
    },
  };
}

/**
 * One route's cache, wrapped around the render.
 *
 * `render` is called with nothing and returns `{ html, cacheable }`. A page is
 * not cacheable when it answered with a `Response`, when its status is not 2xx,
 * or when a loader put a header on the response: a `Set-Cookie` held in a shared
 * cache is somebody else's session handed to the next visitor. That is the same
 * rule the build uses to decide a route can be a file.
 *
 * @param {object} [store] anything with the `memoryStore` shape
 * @param {{ now?: () => number }} [deps] injected so a test can move time
 * @returns {{ resolve: Function, revalidatePath: Function }}
 */
export function createCache(store = memoryStore(), { now = () => Date.now() } = {}) {
  // One render per key at a time. Without this the first request past the window
  // and every request behind it each start their own.
  const inFlight = new Map();

  const refresh = async (key, window, render) => {
    if (inFlight.has(key)) return inFlight.get(key);

    const work = (async () => {
      const result = await render();
      if (result.cacheable) {
        store.set(key, {
          html: result.html,
          tags: window.tags,
          expires: now() + window.seconds * 1000,
        });
      } else {
        // It stopped being cacheable. Holding the last good copy would serve a
        // page the app has decided not to give out.
        store.delete(key);
      }
      return result;
    })().finally(() => inFlight.delete(key));

    inFlight.set(key, work);
    return work;
  };

  return {
    /** `null` when the caller should just render, which is every uncached route. */
    async read(key, window, render) {
      if (!window) return null;

      const hit = store.get(key);
      if (!hit) return refresh(key, window, render).then((result) => result.html);

      if (hit.expires > now()) return hit.html;

      // Stale. Answer with it now and rebuild behind the response. A failed
      // rebuild leaves the stale entry in place rather than emptying the cache
      // because one render threw.
      refresh(key, window, render).catch(() => {});
      return hit.html;
    },

    revalidateTag: (tag) => store.deleteByTag(tag),
    revalidatePath: (key) => store.delete(key),
  };
}

/**
 * Path plus query, because a page that reads `?q=` renders differently for each.
 *
 * @param {string} url an absolute URL
 * @returns {string}
 */
export function cacheKey(url) {
  const { pathname, search } = new URL(url);
  return pathname + search;
}
