/**
 * What a page means by `export const revalidate`, in milliseconds.
 *
 * @param {object|null|undefined} page a compiled page module
 * @returns {number} 0 for a page that is rendered every time
 */
export declare function windowOf(page: object | null | undefined): number;
/**
 * The default store: a bounded map, right for one server.
 *
 * Bounded because the key carries the query string, so a route reading `?q=`
 * has as many entries as there are searches. Oldest out first, which is not
 * least-recently-used and is enough: an entry that matters is rewritten by its
 * own revalidation and moves back to the end.
 *
 * @param {{ max?: number }} [options]
 * @returns {{ get: Function, set: Function, delete: Function, deleteByTag: Function }}
 */
export declare function memoryStore({ max }?: {
    max?: number;
}): {
    get: Function;
    set: Function;
    delete: Function;
    deleteByTag: Function;
};
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
 * @returns {{ read: Function, revalidateTag: Function, revalidatePath: Function }}
 */
export declare function createCache(store?: object, { now }?: {
    now?: () => number;
}): {
    read: Function;
    revalidateTag: Function;
    revalidatePath: Function;
};
/**
 * Path plus query, because a page that reads `?q=` renders differently for each.
 *
 * @param {string} url an absolute URL
 * @returns {string}
 */
export declare function cacheKey(url: string): string;
