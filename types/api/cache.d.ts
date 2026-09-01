export type CacheEntry = {
    html: string;
    tags: string[];
    expires: number;
};
export type CacheStore = {
    get: (key: string) => CacheEntry | undefined;
    set: (key: string, entry: CacheEntry) => void;
    delete: (key: string) => void;
    deleteByTag: (tag: string) => void;
};
export type Window = {
    seconds: number;
    tags: string[];
};
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
export declare function windowOf(page: {
    revalidate?: number | {
        seconds: number;
        tags?: string[];
    } | false | null;
} | null | undefined): Window | null;
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
export declare function memoryStore({ max }?: {
    max?: number;
}): CacheStore;
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
export declare function createCache(store?: CacheStore, { now }?: {
    now?: () => number;
}): {
    read: (key: string, window: Window | null, render: () => Promise<{
        html: string | Response;
        cacheable: boolean;
    }>, after?: ((work: Promise<unknown>) => void) | null) => Promise<string | Response | null>;
    revalidateTag: (tag: string) => void;
    revalidatePath: (key: string) => void;
};
/**
 * Path plus query, because a page that reads `?q=` renders differently for each.
 *
 * @param {string} url an absolute URL
 * @returns {string}
 */
export declare function cacheKey(url: string): string;
