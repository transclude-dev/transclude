// Cloudflare Workers entry for this site. `npm run deploy` sends it.
//
// This file belongs to the site rather than to the framework, because every
// import in it names something the site owns: its build output and its config.
// What a worker does differently from Node is in `@transclude/core/worker`.
//
// The site is served by a worker rather than as a directory of files, and the
// landing page is why: it says a fragment is a URL and links to one, and
// `/?fragment=demo` is a render. A static host matches on path and ignores the
// query, so it would answer that link with the whole document and make the page
// a liar.
//
// The cost of having no filesystem is that the assets travel in the bundle.
// Plain bytes only, and the platform compresses on the way out.

import { createApp } from '@transclude/core/app';
import { bytesFrom, fileHandler, hash, pageEntry } from '@transclude/core/worker';
import { assets, errorPage, notFound, precache, publicFiles, statics } from './dist/server/assets.js';
import { endpoints, middleware, pages } from './dist/server/entry.js';
import manifestText from './dist/routes.json';
import config from './transclude.config.js';

// There is no JSON module type in Workers, so the manifest arrives as a string.
// Using it as an object gives a route table of `undefined` and a site of 404s
// that looks exactly like a routing bug.
const manifest = JSON.parse(manifestText);

/**
 * Built once, on the first request, because that is when `env` exists.
 *
 * There is no `process.env` on this runtime. Anything read at import time is
 * undefined, which is correct and confusing at the same time: the variable is
 * set, it just arrives with the request rather than with the process.
 */
let app = null;

function appFor(env) {
  app ??= createApp({
    config: { ...config, cookieSecret: env.COOKIE_SECRET ?? config.cookieSecret },
    manifest,
    pages,
    endpoints,
    middleware,
    statics: bytesFrom(statics),
    assets: bytesFrom(assets),
    publicFiles: fileHandler(publicFiles),
    notFound: pageEntry(notFound),
    errorPage: pageEntry(errorPage),
    hash,
    // The edge compresses. Doing it here would be a second pass over bytes that
    // are already going through one.
    compress: null,
    precache,
  });
  return app;
}

export default {
  fetch: (request, env, ctx) => appFor(env).fetch(request, env, ctx),
};
