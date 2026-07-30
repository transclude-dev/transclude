// Cloudflare Workers adapter. `wrangler dev framework/bin/serve.worker.js`
//
// The point of this file is that it is short. `app.js` is the whole app and knows
// nothing about any runtime; everything below is the four things a worker does
// differently from Node:
//
//   bytes        no filesystem, so `dist/server/assets.js` is imported instead
//   hashing      no `node:crypto`, so WebCrypto — which is why `hash` is awaited
//   compression  none, because the edge does it; `compress: null` says so
//   public files not a directory, so the same asset map serves them
//   config       `env` arrives with the request, not with the process — so the app
//                is built on the first one rather than at import
//
// The cost of having no filesystem is that the assets are in the bundle. Identity
// encoding only, and the platform compresses on the way out.

import { createApp } from '../src/app.js';
import { assets, errorPage, notFound, publicFiles, statics } from '../../dist/server/assets.js';
import { endpoints, middleware, pages } from '../../dist/server/entry.js';
import manifestText from '../../dist/routes.json';
import config from '../../html-first.config.js';

// There is no JSON module type in Workers, so the manifest arrives as a string.
// Importing it and using it as an object gave a route table of `undefined` and a
// site of 404s that looked exactly like a routing bug.
const manifest = JSON.parse(manifestText);

/** base64 in, bytes out. `atob` is in every runtime that has no `Buffer`. */
const decode = (base64) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

/**
 * The same entry shape the Node server builds from a disk. `encodings` is empty
 * because nothing here is precompressed, and the code that reads it already
 * treats an empty map as "identity is all there is".
 */
function provider(map) {
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
 * A synchronous ETag for bytes that are fixed at build time — hashing them with
 * WebCrypto would make building the provider async for no gain. Content length
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

/** Rendered responses get the real thing, which on this runtime is async. */
async function hash(body) {
  const digest = await crypto.subtle.digest('SHA-1', body);
  const bytes = new Uint8Array(digest);
  let base64 = '';
  for (const byte of bytes) base64 += String.fromCharCode(byte);
  return `"${btoa(base64).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 20)}"`;
}

const files = provider(publicFiles);
const entry = (page) =>
  page && { body: decode(page.body), type: page.type, etag: '"error"', encodings: new Map() };

/**
 * Built once, on the first request, because that is when `env` exists.
 *
 * There is no `process.env` here. A secret read at import time would be undefined
 * and signing would refuse — correctly, and confusingly, since the variable *is*
 * set. Configuration on this runtime arrives with the request.
 */
let app = null;

function appFor(env) {
  app ??= createApp({
    config: { ...config, cookieSecret: env.COOKIE_SECRET ?? config.cookieSecret },
    manifest,
    pages,
    endpoints,
    middleware,
    statics: provider(statics),
    assets: provider(assets),
    // A handler rather than a directory. No byte ranges — that is what a
    // filesystem buys, and this runtime has none.
    publicFiles: async (c, next) => {
      const hit = files.get(c.req.path);
      if (!hit) return next();
      c.header('Content-Type', hit.type);
      c.header('ETag', hit.etag);
      return c.body(hit.body);
    },
    notFound: entry(notFound),
    errorPage: entry(errorPage),
    hash,
    compress: null,
  });
  return app;
}

export default {
  fetch: (request, env, ctx) => appFor(env).fetch(request, env, ctx),
};
