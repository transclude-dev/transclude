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
 * One entry in the store: the markup, when it goes stale, and what it answers to.
 *
 * @typedef {{ html: string, tags: string[], expires: number }} CacheEntry
 *
 * @typedef {object} CacheStore
 * @property {(key: string) => CacheEntry|undefined} get
 * @property {(key: string, entry: CacheEntry) => void} set
 * @property {(key: string) => void} delete
 * @property {(tag: string) => void} deleteByTag
 *
 * @typedef {{ seconds: number, tags: string[] }} Window how long an entry lives
 */

/**
 * What a page means by `export const revalidate`.
 *
 * @param {{ revalidate?: number|{ seconds: number, tags?: string[] }|false|null }
 *   |null|undefined} page a compiled page module
 * @returns {Window|null} null for a page that is rendered every time
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
 * @returns {CacheStore}
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
 * How long an unfinished render may hold a key.
 *
 * The map exists so one render happens per key. It assumed every promise it held
 * would settle. On workerd one may not: the isolate is allowed to stop when the
 * response is sent, and it stops the work with it. The `finally` never runs, the
 * entry stays, and every later request for that key waits on a promise that is
 * already dead. The page hangs for as long as the isolate lives.
 *
 * `after` is the fix, and this is the bound on it being wrong. A render slower
 * than this loses its claim on the key rather than keeping it forever.
 */
const ABANDONED_MS = 30_000;

/**
 * Keeps the background rebuild alive, and its failure off the unhandled path.
 *
 * `after` is `waitUntil` on workerd and a no-op elsewhere, and it attaches its
 * own catch. Without one, the catch here is all there is: a rebuild that throws
 * must not take down a process that was only serving a stale page.
 *
 * @param {Promise<unknown>} work
 * @param {((work: Promise<unknown>) => void)|null} after
 */
function hold(work, after) {
  if (after) after(work);
  else work.catch(() => {});
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
 * @param {CacheStore} [store] anything with the `memoryStore` shape
 * @param {{ now?: () => number }} [deps] injected so a test can move time
 * @returns {{ read: (key: string, window: Window|null,
 *   render: () => Promise<{ html: string|Response, cacheable: boolean }>,
 *   after?: ((work: Promise<unknown>) => void)|null) => Promise<string|Response|null>,
 *   revalidateTag: (tag: string) => void, revalidatePath: (key: string) => void }}
 */
export function createCache(store = memoryStore(), { now = () => Date.now() } = {}) {
  // One render per key at a time. Without this the first request past the window
  // and every request behind it each start their own.
  const inFlight = new Map();

  const refresh = (key, window, render) => {
    const current = inFlight.get(key);
    if (current && now() - current.at < ABANDONED_MS) return current.work;

    const started = now();

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
    })().finally(() => {
      // Only if this is still the entry made above. A render that ran past
      // ABANDONED_MS was replaced, and it must not delete its replacement.
      if (inFlight.get(key)?.at === started) inFlight.delete(key);
    });

    inFlight.set(key, { work, at: started });
    return work;
  };

  return {
    /**
     * `null` when the caller should just render, which is every uncached route.
     *
     * `after` is the request's `ctx.after`. Only the stale path uses it, and a
     * caller that leaves it out gets a rebuild nothing holds, which is what this
     * used to do everywhere.
     */
    async read(key, window, render, after = null) {
      if (!window) return null;

      const hit = store.get(key);
      if (!hit) return refresh(key, window, render).then((result) => result.html);

      if (hit.expires > now()) return hit.html;

      // Stale. Answer with it now and rebuild behind the response. A failed
      // rebuild leaves the stale entry in place rather than emptying the cache
      // because one render threw.
      //
      // `after` is what keeps the rebuild alive. On workerd the isolate may stop
      // the moment the response is sent, and work nothing holds stops with it.
      hold(refresh(key, window, render), after);
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
