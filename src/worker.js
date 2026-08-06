// The half of a worker entry that is not about one app.
//
// A worker has no filesystem, so its bytes are imported from a module the build
// emitted rather than read from a disk, and it has no `node:crypto`, so hashing
// is WebCrypto and therefore async. Those are runtime facts, so they live here.
// Which modules to import is an app fact, so that stays in the app's own entry.

import { createApp } from './app.js';

/** base64 in, bytes out. `atob` is in every runtime that has no `Buffer`. */
const decode = (base64) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

/**
 * A synchronous ETag for bytes that are fixed at build time. Hashing them with
 * WebCrypto would make building the provider async for nothing. Content length
 * plus an FNV-1a pass is a cache key, not a signature.
 */
function etagOf(bytes) {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `"${bytes.length.toString(36)}-${hash.toString(36)}"`;
}

/**
 * The same entry shape the Node server builds from a disk. `encodings` is empty
 * because nothing here is precompressed, and the code that reads it already
 * treats an empty map as "identity is all there is".
 *
 * @param {Record<string, { body: string, type: string }>} map base64 from the build
 * @returns {{ get: (pathname: string) => object|null }} the same entries with
 *   real bytes, behind the lookup `createApp` uses
 */
export function bytesFrom(map) {
  const built = new Map();
  for (const [url, { type, body }] of Object.entries(map)) {
    const bytes = decode(body);
    built.set(url, { body: bytes, type, etag: etagOf(bytes), encodings: new Map() });
  }
  return {
    get(pathname) {
      // Trailing slashes are the same resource, as they are on the Node side.
      return built.get(pathname.replace(/\/+$/, '') || '/') ?? null;
    },
  };
}

/**
 * Public files, as a handler rather than a directory. No byte ranges, because
 * those need a filesystem and this runtime has none.
 *
 * @param {Record<string, object>} map
 * @returns {Function} a Hono handler
 */
export function fileHandler(map) {
  const files = bytesFrom(map);
  return async (c, next) => {
    const hit = files.get(c.req.path);
    if (!hit) return next();
    c.header('Content-Type', hit.type);
    c.header('ETag', hit.etag);
    return c.body(hit.body);
  };
}

/**
 * A prerendered error page, which is sent as bytes and never revalidated.
 *
 * @param {{ body: string, type: string }|null|undefined} page base64 from the build
 * @returns {object|null} the entry shape `send` expects
 */
export const pageEntry = (page) =>
  page && { body: decode(page.body), type: page.type, etag: '"error"', encodings: new Map() };

/**
 * Rendered responses get the real thing, which on this runtime is async.
 *
 * @param {Uint8Array} body
 * @returns {Promise<string>} a quoted ETag
 */
export async function hash(body) {
  const digest = await crypto.subtle.digest('SHA-1', body);
  const bytes = new Uint8Array(digest);
  let base64 = '';
  for (const byte of bytes) base64 += String.fromCharCode(byte);
  return `"${btoa(base64).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 20)}"`;
}

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
export function workerFrom({ config, manifest, entry, bundle }) {
  // Built on the first request rather than at import, because that is when
  // `env` exists. There is no `process.env` here, so a secret read any earlier
  // is undefined, and signing refuses.
  let app = null;

  return {
    fetch(request, env, ctx) {
      app ??= createApp({
        config: { ...config, cookieSecret: env.COOKIE_SECRET ?? config.cookieSecret },
        // There is no JSON module type in Workers, so the manifest usually
        // arrives as a string. Used as an object it gives a route table of
        // `undefined` and a site of 404s that looks exactly like a routing bug.
        manifest: typeof manifest === 'string' ? JSON.parse(manifest) : manifest,
        pages: entry.pages,
        endpoints: entry.endpoints,
        middleware: entry.middleware,
        statics: bytesFrom(bundle.statics),
        assets: bytesFrom(bundle.assets),
        publicFiles: fileHandler(bundle.publicFiles),
        notFound: pageEntry(bundle.notFound),
        errorPage: pageEntry(bundle.errorPage),
        hash,
        // The edge compresses. Doing it here would be a second pass over bytes
        // already going through one.
        compress: null,
        precache: bundle.precache,
      });

      return app.fetch(request, env, ctx);
    },
  };
}
