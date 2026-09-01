export declare const PROXY_PATH = "/_transclude/proxy";
export type ProxyConfig = {
    /**
     * the hostnames that may be read
     */
    allow?: string[];
    maxBytes?: number;
    timeout?: number;
    redirects?: number;
    sanitize?: boolean;
    styles?: 'keep' | 'strip';
    /**
     * how many documents to hold
     */
    cache?: number;
    maxAge?: number;
    lookup?: Function | null;
};
export type Held = {
    doc: import('./extract.js').Indexed;
    base: string;
    /**
     * what the sanitizer took out
     */
    removed: string[];
    /**
     * when it was read
     */
    at: number;
    etag: string | null;
    lastModified: string | null;
};
export type DocumentStore = {
    get: (key: string) => Held | null;
    set: (key: string, entry: Held) => void;
    size: number;
};
/**
 * Parsed documents, by the URL they finally came from.
 *
 * Several fragments usually come from one page, so the parse, the cleaning and
 * the slug table are done once and shared. Keyed by the final URL rather than
 * the requested one, so two requests that redirect to the same place hit.
 *
 * @param {number} [max] how many documents to hold
 * @returns {DocumentStore}
 */
export declare function documentStore(max?: number): DocumentStore;
/**
 * A foreign document, fetched, cleaned and indexed.
 *
 * The order is deliberate: read the base before `<base>` is stripped, strip
 * before rewriting so nothing rewrites a URL on an element about to be removed,
 * and index last so the table never names something the cleaning took out.
 *
 * @param {string} url
 * @param {ProxyConfig} [options] the `proxy` config
 * @param {{ fetch?: Function, store?: DocumentStore|null, now?: () => number,
 *   lookup?: Function }} [deps]
 * @returns {Promise<Held>} the indexed document, its base, and what was removed
 */
export declare function readForeign(url: string, options?: ProxyConfig, deps?: {
    fetch?: Function;
    store?: DocumentStore | null;
    now?: () => number;
    lookup?: Function;
}): Promise<Held>;
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
 * @param {ProxyConfig} [options]
 * @param {{ store?: DocumentStore, fetch?: Function, now?: () => number,
 *   lookup?: Function }} [deps]
 * @returns {{ resolve: (url: string, id: string) => Promise<string> }}
 */
export declare function includeResolver(options?: ProxyConfig, deps?: {
    store?: DocumentStore;
    fetch?: Function;
    now?: () => number;
    lookup?: Function;
}): {
    resolve: (url: string, id: string) => Promise<string>;
};
/**
 * @param {ProxyConfig} [options]
 * @param {{ store?: DocumentStore, fetch?: Function, now?: () => number,
 *   lookup?: Function }} [deps]
 * @returns {(request: Request) => Promise<Response>}
 */
export declare function proxyHandler(options?: ProxyConfig, deps?: {
    store?: DocumentStore;
    fetch?: Function;
    now?: () => number;
    lookup?: Function;
}): (request: Request) => Promise<Response>;
