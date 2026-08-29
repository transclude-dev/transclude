export declare const PROXY_PATH = "/_transclude/proxy";
/**
 * Parsed documents, by the URL they finally came from.
 *
 * Several fragments usually come from one page, so the parse, the cleaning and
 * the slug table are done once and shared. Keyed by the final URL rather than
 * the requested one, so two requests that redirect to the same place hit.
 *
 * @param {number} [max] how many documents to hold
 * @returns {{ get: Function, set: Function, size: () => number }}
 */
export declare function documentStore(max?: number): {
    get: Function;
    set: Function;
    size: () => number;
};
/**
 * A foreign document, fetched, cleaned and indexed.
 *
 * The order is deliberate: read the base before `<base>` is stripped, strip
 * before rewriting so nothing rewrites a URL on an element about to be removed,
 * and index last so the table never names something the cleaning took out.
 *
 * @param {string} url
 * @param {object} [options] the `proxy` config
 * @param {{ fetch?: Function, store?: object, now?: Function, lookup?: Function }} [deps]
 * @returns {Promise<object>} the indexed document, its base, and what was removed
 */
export declare function readForeign(url: string, options?: object, deps?: {
    fetch?: Function;
    store?: object;
    now?: Function;
    lookup?: Function;
}): Promise<object>;
/**
 * `GET /_transclude/proxy?url=…&id=…`
 *
 * Answers with the fragment, as markup. A page fetches this from its own origin,
 * which is also what makes it work at all: a cross-origin fetch is refused by
 * the default policy, which names `'self'` and nothing else.
 */
/**
 * A resolver for `renderRoute`: the markup of one fragment of one URL.
 *
 * Shares a store with nothing else on purpose. Includes are resolved during a
 * render, and holding the parsed document is what makes ten of them off one page
 * cost one read.
 *
 * @param {object} [options]
 * @param {object} [deps]
 * @returns {{ resolve: (url: string, id: string) => Promise<string> }}
 */
export declare function includeResolver(options?: object, deps?: object): {
    resolve: (url: string, id: string) => Promise<string>;
};
/**
 * @param {object} [options]
 * @param {object} [deps]
 * @returns {(request: Request) => Promise<Response>}
 */
export declare function proxyHandler(options?: object, deps?: object): (request: Request) => Promise<Response>;
