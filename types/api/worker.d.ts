export type Encoded = {
    body: string;
    type: string;
};
/**
 * A file the build turned into base64, which is how bytes cross into a worker
 * bundle: there is no disk to read them from and no `Buffer` to hold them.
 *
 * @typedef {{ body: string, type: string }} Encoded
 */
/**
 * The same entry shape the Node server builds from a disk. `encodings` is empty
 * because nothing here is precompressed, and the code that reads it already
 * treats an empty map as "identity is all there is".
 *
 * @param {Record<string, Encoded>} map base64 from the build
 * @returns {import('./static-cache.js').ByteStore} the same entries with real
 *   bytes, behind the lookup `createApp` uses
 */
export declare function bytesFrom(map: Record<string, Encoded>): import('./static-cache.js').ByteStore;
/**
 * Public files, as a handler rather than a directory. No byte ranges, because
 * those need a filesystem and this runtime has none.
 *
 * @param {Record<string, Encoded>} map
 * @returns {Function} a Hono handler
 */
export declare function fileHandler(map: Record<string, Encoded>): Function;
/**
 * A prerendered error page, which is sent as bytes and never revalidated.
 *
 * @param {Encoded|null|undefined} page base64 from the build
 * @returns {import('./static-cache.js').Entry|null} the entry shape `send` expects
 */
export declare const pageEntry: (page: Encoded | null | undefined) => import('./static-cache.js').Entry | null;
/**
 * Rendered responses get the real thing, which on this runtime is async.
 *
 * `Uint8Array<ArrayBuffer>` rather than a bare `Uint8Array`, whose buffer could
 * be a `SharedArrayBuffer` as far as the type is concerned, and `digest` takes
 * neither that nor a union holding it.
 *
 * @param {Uint8Array<ArrayBuffer>} body
 * @returns {Promise<string>} a quoted ETag
 */
export declare function hash(body: Uint8Array<ArrayBuffer>): Promise<string>;
/**
 * The whole worker, for an app that wants the ordinary wiring.
 *
 * Nine apps in this repository wrote the same forty lines: parse the manifest,
 * wrap each byte map, build the app on the first request because that is when
 * `env` exists, and hand the request on. The imports have to stay in the app's
 * own file, because a bundler needs a literal path to follow. The wiring does
 * not, and this is it.
 *
 * `cookieSecret` comes from `env.COOKIE_SECRET` when there is one, which is the
 * only piece of config a worker cannot read at import time. An app needing
 * something else calls `createApp` itself: this covers the common shape rather
 * than every shape.
 *
 * @param {object} options
 * @param {import('./defaults.js').Config} options.config the app's `transclude.config.js`
 * @param {string|import('./routes.js').Manifest} options.manifest `dist/routes.json`,
 *   text or parsed
 * @param {{ pages: Record<string, object>, endpoints?: Record<string, object>,
 *   middleware?: Function|null }} options.entry everything
 *   `dist/server/entry.js` exports
 * @param {{ statics: Record<string, Encoded>, assets: Record<string, Encoded>,
 *   publicFiles: Record<string, Encoded>, notFound?: Encoded|null,
 *   errorPage?: Encoded|null, precache?: string|null }} options.bundle everything
 *   `dist/server/assets.js` exports
 * @returns {{ fetch: (request: Request, env: { COOKIE_SECRET?: string },
 *   ctx: object) => Response|Promise<Response> }}
 */
export declare function workerFrom({ config, manifest, entry, bundle }: {
    config: import('./defaults.js').Config;
    manifest: string | import('./routes.js').Manifest;
    entry: {
        pages: Record<string, object>;
        endpoints?: Record<string, object>;
        middleware?: Function | null;
    };
    bundle: {
        statics: Record<string, Encoded>;
        assets: Record<string, Encoded>;
        publicFiles: Record<string, Encoded>;
        notFound?: Encoded | null;
        errorPage?: Encoded | null;
        precache?: string | null;
    };
}): {
    fetch: (request: Request, env: {
        COOKIE_SECRET?: string;
    }, ctx: object) => Response | Promise<Response>;
};
