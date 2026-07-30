// Cloudflare Workers entry for this app. `npm run start:worker`
//
// This file is the app's, not the framework's, because every import in it names
// something the app owns: its build output and its config. What a worker does
// differently from Node is in `transclude/worker`, which this wires up.
//
// The cost of having no filesystem is that the assets are in the bundle. Plain
// bytes only, and the platform compresses on the way out.

import { createApp } from 'transclude/app';
import { bytesFrom, fileHandler, hash, pageEntry } from 'transclude/worker';
import { assets, errorPage, notFound, publicFiles, statics } from './dist/server/assets.js';
import { endpoints, middleware, pages } from './dist/server/entry.js';
import manifestText from './dist/routes.json';
import config from './transclude.config.js';

// There is no JSON module type in Workers, so the manifest arrives as a string.
// Importing it and using it as an object gave a route table of `undefined` and a
// site of 404s that looked exactly like a routing bug.
const manifest = JSON.parse(manifestText);

/**
 * Built once, on the first request, because that is when `env` exists.
 *
 * There is no `process.env` here. A secret read at import time would be undefined
 * and signing would refuse. That is correct and confusing at the same time,
 * because the variable is set. Config on this runtime arrives with the request.
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
    compress: null,
  });
  return app;
}

export default {
  fetch: (request, env, ctx) => appFor(env).fetch(request, env, ctx),
};
