/**
 * The same entry shape the Node server builds from a disk. `encodings` is empty
 * because nothing here is precompressed, and the code that reads it already
 * treats an empty map as "identity is all there is".
 *
 * @param {Record<string, { body: string, type: string }>} map base64 from the build
 * @returns {{ get: (pathname: string) => object|null }} the same entries with
 *   real bytes, behind the lookup `createApp` uses
 */
export declare function bytesFrom(map: Record<string, {
    body: string;
    type: string;
}>): {
    get: (pathname: string) => object | null;
};
/**
 * Public files, as a handler rather than a directory. No byte ranges, because
 * those need a filesystem and this runtime has none.
 *
 * @param {Record<string, object>} map
 * @returns {Function} a Hono handler
 */
export declare function fileHandler(map: Record<string, object>): Function;
/**
 * A prerendered error page, which is sent as bytes and never revalidated.
 *
 * @param {{ body: string, type: string }|null|undefined} page base64 from the build
 * @returns {object|null} the entry shape `send` expects
 */
export declare const pageEntry: (page: {
    body: string;
    type: string;
} | null | undefined) => object | null;
/**
 * Rendered responses get the real thing, which on this runtime is async.
 *
 * @param {Uint8Array} body
 * @returns {Promise<string>} a quoted ETag
 */
export declare function hash(body: Uint8Array): Promise<string>;
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
 * @param {object} options.config the app's `transclude.config.js`
 * @param {string|object} options.manifest `dist/routes.json`, text or parsed
 * @param {object} options.entry everything `dist/server/entry.js` exports
 * @param {object} options.bundle everything `dist/server/assets.js` exports
 * @returns {{ fetch: (request: Request, env: object, ctx: object) => Response|Promise<Response> }}
 */
export declare function workerFrom({ config, manifest, entry, bundle }: {
    config: object;
    manifest: string | object;
    entry: object;
    bundle: object;
}): {
    fetch: (request: Request, env: object, ctx: object) => Response | Promise<Response>;
};
