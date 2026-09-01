/** Below this, the framing costs more than it saves. A 91 byte file gzips to 120. */
export declare const COMPRESSIBLE_FLOOR = 512;
/**
 * `statics`, `assets`, `notFound` and `errorPage` are bytes from wherever the
 * runtime keeps them; `publicFiles` is a Hono handler or null; `compress` is null
 * when the runtime cannot, in which case bodies go out identity-encoded and the
 * platform in front is welcome to do it instead.
 *
 * `hash` returns a quoted ETag and is awaited, which is not fussiness: Node has a
 * synchronous `createHash` and a runtime with only WebCrypto has an async
 * `subtle.digest`. Awaiting costs nothing on the first and is the only way to
 * accept the second.
 *
 * The body is long because the order routes are registered in *is* the behavior,
 * so it is written out once, in that order, rather than split across functions
 * that could be called in a different one. What gets registered, in order:
 *
 *   /assets/*        hashed, so immutable
 *   sitemap, precache, feed, proxy    each only if the config asked for it
 *   fragments and actions             every route, before anything static
 *   endpoints                         before the static handler, which matches
 *                                     on path alone and would answer first
 *   prerendered pages                 bytes from disk
 *   pages                             every route, not only the dynamic ones
 *   not found
 *
 * The two rules worth knowing: a fragment or an action has to come before the
 * prerendered handler, and an endpoint's path has no file behind it but
 * `/api/notes` and a prerendered `/api/notes/index.html` look the same to a
 * matcher.
 *
 * @param {{ config: import('./defaults.js').Config,
 *   manifest: import('./routes.js').Manifest, pages: Record<string, object>,
 *   endpoints?: Record<string, object>,
 *   statics?: import('./static-cache.js').ByteStore,
 *   assets?: import('./static-cache.js').ByteStore,
 *   notFound?: import('./static-cache.js').Entry|null,
 *   errorPage?: import('./static-cache.js').Entry|null, hash: Function,
 *   compress?: Function|null, publicFiles?: Function|null,
 *   middleware?: Function|null, lookup?: Function|null,
 *   precache?: string|null }} options
 * @returns {import('hono').Hono} a Hono app, ready to serve
 */
export declare function createApp({ config: written, manifest, pages, endpoints, middleware, statics, assets, publicFiles, notFound, errorPage, hash, compress, precache, lookup, }: {
    config: import('./defaults.js').Config;
    manifest: import('./routes.js').Manifest;
    pages: Record<string, object>;
    endpoints?: Record<string, object>;
    statics?: import('./static-cache.js').ByteStore;
    assets?: import('./static-cache.js').ByteStore;
    notFound?: import('./static-cache.js').Entry | null;
    errorPage?: import('./static-cache.js').Entry | null;
    hash: Function;
    compress?: Function | null;
    publicFiles?: Function | null;
    middleware?: Function | null;
    lookup?: Function | null;
    precache?: string | null;
}): import('hono').Hono;
