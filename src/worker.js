// The half of a worker entry that is not about one app.
//
// A worker has no filesystem, so its bytes are imported from a module the build
// emitted rather than read from a disk, and it has no `node:crypto`, so hashing
// is WebCrypto and therefore async. Those are runtime facts, so they live here.
// Which modules to import is an app fact, so that stays in the app's own entry.

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
