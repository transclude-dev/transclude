// The half of a worker entry that is not about one app.
//
// A worker has no filesystem, so its bytes are imported from a module the build
// emitted rather than read from a disk, and it has no `node:crypto`, so hashing
// is WebCrypto and therefore async. Those are runtime facts, so they live here.
// Which modules to import is an app fact, so that stays in the app's own entry.
//
// The build writes two such modules. `dist/server/assets.js` carries every
// file. `dist/server/pages.js` carries the prerendered pages only, for a
// worker whose public files and hashed assets the edge serves from
// `dist/edge`. Both go through `workerFrom`.

import { createApp } from './app.js';

/** base64 in, bytes out. `atob` is in every runtime that has no `Buffer`. */
const decode = (base64) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

/**
 * A file the build turned into base64, which is how bytes cross into a worker
 * bundle: there is no disk to read them from and no `Buffer` to hold them. The
 * build makes the ETag too, with the function the Node server uses, so the two
 * send the same one for the same bytes.
 *
 * A public file carries the date its file was last changed, as the Node server
 * reads it off the disk.
 *
 * @typedef {{ body: string, type: string, etag: string, lastModified?: string }} Encoded
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
export function bytesFrom(map) {
  const built = new Map();
  for (const [url, { type, body, etag, lastModified }] of Object.entries(map)) {
    built.set(url, { body: decode(body), type, etag, lastModified, encodings: new Map() });
  }
  return {
    get(pathname) {
      // Trailing slashes are the same resource, as they are on the Node side.
      return built.get(pathname.replace(/\/+$/, '') || '/') ?? null;
    },
  };
}

/** The same as the Node server's for a public file. */
const REVALIDATE = 'public, max-age=0, must-revalidate';

/**
 * Public files, as a handler rather than a directory. What the Node server
 * sends for the same file: its type, its validator, `Last-Modified`,
 * `Cache-Control`, a 304 for a matching `If-None-Match`, and a byte range for a
 * `Range`. The bytes are in memory, so a range is a slice of them.
 *
 * @param {Record<string, Encoded>} map
 * @returns {import('hono').MiddlewareHandler} a Hono handler
 */
export function fileHandler(map) {
  const files = bytesFrom(map);
  return async (c, next) => {
    const hit = files.get(c.req.path);
    if (!hit) return next();
    c.header('Content-Type', hit.type);
    c.header('ETag', hit.etag);
    if (hit.lastModified) c.header('Last-Modified', hit.lastModified);
    c.header('Cache-Control', REVALIDATE);

    const range = c.req.header('range');
    if (range) return sendRange(c, hit.body, range);
    if (c.req.header('if-none-match') === hit.etag) return c.body(null, 304);
    if (c.req.method === 'HEAD' || c.req.method === 'OPTIONS') return c.body(null, 200);
    // Hono types a body as `string | ArrayBuffer | ReadableStream`, which is
    // narrower than what a `Response` accepts: a typed array goes through
    // untouched. Sending `hit.body.buffer` instead would be a different promise,
    // because a view does not have to cover its buffer.
    return c.body(/** @type {ArrayBuffer} */ (/** @type {unknown} */ (hit.body)));
  };
}

/**
 * One byte range, the way `serveStatic` answers it on Node: 206 with the slice,
 * or 416 when the range lies outside the file. A `Range` it cannot read means
 * the whole file, as a 206. One range only, as there.
 *
 * @param {import('hono').Context} c
 * @param {Uint8Array} body
 * @param {string} range the `Range` header
 */
function sendRange(c, body, range) {
  c.header('Accept-Ranges', 'bytes');
  const size = body.length;
  const wanted = byteRange(range, size);
  if (!wanted) {
    c.header('Content-Range', `bytes */${size}`);
    return c.body(null, 416);
  }
  c.header('Content-Range', `bytes ${wanted.start}-${wanted.end}/${size}`);
  const slice = body.subarray(wanted.start, wanted.end + 1);
  return c.body(/** @type {ArrayBuffer} */ (/** @type {unknown} */ (slice)), 206);
}

/**
 * `bytes=10-20`, `bytes=10-` and `bytes=-20`, resolved against the size, or
 * null when nothing of the file is in it. Hono's rules in `serveStatic`,
 * written out again because that module reads a disk and this runtime has none.
 *
 * @param {string} range
 * @param {number} size
 * @returns {{ start: number, end: number } | null}
 */
function byteRange(range, size) {
  if (size === 0) return null;
  const match = range.match(/^(?:bytes=)?(?!-$)(\d*)-(\d*)$/);
  const from = match ? match[1] : '0';
  const to = match ? match[2] : '';
  if (from === '') {
    const length = Number(to);
    return length === 0 ? null : { start: Math.max(size - length, 0), end: size - 1 };
  }
  const start = Number(from);
  const end = to === '' ? size - 1 : Math.min(Number(to), size - 1);
  if (start >= size || start > end) return null;
  return { start, end };
}

/**
 * A prerendered error page, with the ETag the build made for it. The 404 page
 * sends it, as the Node server's does. The 500 page sends none.
 *
 * @param {Encoded|null|undefined} page base64 from the build
 * @returns {import('./static-cache.js').Entry|null} the entry shape `send` expects
 */
export const pageEntry = (page) =>
  page && { body: decode(page.body), type: page.type, etag: page.etag, encodings: new Map() };

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
 * @param {import('./defaults.js').Config} options.config the app's `transclude.config.js`
 * @param {string|import('./routes.js').Manifest} options.manifest `dist/routes.json`,
 *   text or parsed
 * @param {{ pages: Record<string, import('./document.js').PageModule>,
 *   endpoints?: Record<string, object>,
 *   middleware?: ((app: import('hono').Hono) => void)|null }} options.entry
 *   everything `dist/server/entry.js` exports
 * @param {{ statics: Record<string, Encoded>, assets?: Record<string, Encoded>,
 *   publicFiles?: Record<string, Encoded>, notFound?: Encoded|null,
 *   errorPage?: Encoded|null, precache?: string|null }} options.bundle everything
 *   `dist/server/assets.js` exports, or `dist/server/pages.js`, which has no
 *   `assets` and no `publicFiles` because the edge serves those
 * @returns {{ fetch: (request: Request, env: { COOKIE_SECRET?: string },
 *   ctx: object) => Response|Promise<Response> }}
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
        // Absent from `pages.js`. The edge answers those requests before the
        // worker runs, so a miss here is a file that does not exist.
        assets: bytesFrom(bundle.assets ?? {}),
        publicFiles: bundle.publicFiles ? fileHandler(bundle.publicFiles) : null,
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
