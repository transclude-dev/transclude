// The production app: no Vite, no compiler — everything it serves was decided at
// build time. Prerendered HTML first, then whatever is left to render on demand.
//
// A Hono app and nothing else. `app.fetch` is (Request) => Response, which is what
// every runtime worth targeting speaks, so listening is somebody else's file:
// `bin/serve.js` for Node, `bin/serve.bun.js`, `bin/serve.deno.js`. What is *not*
// portable is reading `dist` off a disk — a runtime without a filesystem needs its
// assets some other way, and this is not that adapter.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  ACTION_METHODS,
  hasRegion,
  methodsOf,
  renderFragment,
  renderRoute,
  responseOf,
  runAction,
  withEnvelope,
} from './document.js';
import { etagOf, loadAssets, loadStatic } from './static-cache.js';
import { pickEncoding } from './negotiate.js';
import { COMPRESSIBLE_FLOOR, compressResponse } from './compress.js';
import { baseApp, endpointMethods, runEndpoint } from './server.js';
import { cookiesOf } from './cookies.js';
import config from '../../html-first.config.js';

// `fileURLToPath`, not `url.pathname`: a space in the path stays percent-encoded
// in the latter, and `Atelier%20Dakroub` is not a directory.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dist = path.join(root, config.outDir);

export const noBuild = !fs.existsSync(path.join(dist, 'routes.json'));

/**
 * This server reads `dist`, never the source. An edit made since the last build
 * is invisible here, which looks exactly like the edit not working — so say so
 * rather than let it be discovered.
 */
function newestSource() {
  const roots = [path.join(root, config.appDir), path.join(root, 'framework/src')];
  let newest = { time: 0, file: null };

  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        const { mtimeMs } = fs.statSync(full);
        if (mtimeMs > newest.time) newest = { time: mtimeMs, file: full };
      }
    }
  };

  for (const dir of roots) walk(dir);
  const configFile = path.join(root, 'html-first.config.js');
  if (fs.existsSync(configFile)) {
    const { mtimeMs } = fs.statSync(configFile);
    if (mtimeMs > newest.time) newest = { time: mtimeMs, file: configFile };
  }
  return newest;
}

const builtAt = fs.statSync(path.join(dist, 'routes.json')).mtimeMs;
const newest = newestSource();
const stale = newest.time > builtAt;

const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'routes.json'), 'utf8'));
const { pages, endpoints, middleware } = await import(
  pathToFileURL(path.join(dist, 'server/entry.js')).href,
);

const assets = loadAssets(path.join(dist, 'client'));
const statics = loadStatic(path.join(dist, 'static'));

const IMMUTABLE = 'public, max-age=31536000, immutable';
const REVALIDATE = 'public, max-age=0, must-revalidate';

// `dist/public`, not the source `public/`: this server reads dist and nothing
// else, which is what makes its "your source is newer than this build" warning
// true.
const app = baseApp({
  csrf: config.csrf,
  trailingSlash: config.trailingSlash,
  publicRoot: path.join(dist, 'public'),
  middleware,
});

// Hashed filenames, so these are safe to cache forever.
app.get('/assets/*', (c, next) => {
  const asset = assets.get(c.req.path);
  return asset ? send(c, asset, IMMUTABLE) : next();
});

/**
 * What every loader and action is handed. `request` is the platform's own
 * `Request` rather than the server's wrapper — the framework should not be the
 * reason an author learns a router's API to read a form.
 */
const contextFor = (route, c, extra = {}) => ({
  url: c.req.url,
  params: c.req.param(),
  route: { id: route.id, pattern: route.pattern, path: c.req.path },
  request: c.req.raw,
  // The region this request asked for, or null for a whole document. An action
  // needs it to decide whether a redirect is even an answer: post/redirect/get
  // is right for a form, and wrong for a caller that asked for markup.
  fragment: fragmentOf(c),
  action: null,
  ...withResponse(c, extra),
});

/**
 * The envelope and the cookies that write into it, built together — the cookie
 * helpers hold the same `response` the server will read, so a `set` in a loader
 * lands on the way out.
 */
function withResponse(c, extra) {
  const response = responseOf();
  return {
    response,
    cookies: cookiesOf(c.req.raw, response, config.cookieSecret),
    ...extra,
  };
}

/** The region this request is asking for, or null for the whole document. */
function fragmentOf(c) {
  if (!config.fragmentParam) return null;
  const value = c.req.query(config.fragmentParam);
  return value === undefined ? null : value;
}

/**
 * Fragments and actions come first, and for every route rather than only the
 * dynamic ones: a page whose document was prerendered still has regions worth
 * asking for and mutations worth accepting, and the prerendered file below
 * matches on path alone — it would happily answer either with a static document.
 */
for (const route of manifest.routes ?? []) {
  app.get(route.pattern, async (c, next) => {
    const region = config.fragmentParam ? c.req.query(config.fragmentParam) : undefined;
    if (region === undefined) return next();

    try {
      const ctx = contextFor(route, c);
      const html = await renderFragment(pages[route.id], ctx, { region: region || null });

      if (html instanceof Response) return withEnvelope(html, ctx);
      if (html === null) return c.text(`no fragment "${region}"`, 404);
      return sendRendered(c, html, ctx);
    } catch (err) {
      return internalError(c, err);
    }
  });

  app.on(ACTION_METHODS, route.pattern, async (c) => {
    const page = pages[route.id];
    const region = config.fragmentParam ? c.req.query(config.fragmentParam) : undefined;
    try {
      // Before the action, not after: a request nobody can answer should not
      // have mutated anything on its way to saying so.
      if (region !== undefined && !hasRegion(page, region)) {
        return c.text(`no fragment "${region}"`, 404);
      }

      const acting = contextFor(route, c);
      const outcome = await runAction(page, acting, c.req.method);
      if (!outcome) {
        return c.text(`${c.req.method} not allowed`, 405, { Allow: methodsOf(page).join(', ') });
      }
      if (outcome.response) return withEnvelope(outcome.response, acting);

      // The render reuses the action's envelope and cookies, so a header it set
      // on the way through is still there when the page comes back instead.
      const ctx = contextFor(route, c, {
        action: outcome.action,
        response: acting.response,
        cookies: acting.cookies,
      });
      const html =
        region === undefined
          ? await renderRoute(page, ctx, { clientEntry: route.client, stylesheet: manifest.stylesheet })
          : await renderFragment(page, ctx, { region: region || null });

      if (html instanceof Response) return withEnvelope(html, ctx);
      return sendRendered(c, html, ctx);
    } catch (err) {
      return internalError(c, err);
    }
  });
}

// Before the static handler, like fragments and actions: an endpoint's path has
// no file behind it, but `/api/notes` and a prerendered `/api/notes/index.html`
// would be indistinguishable to the matcher below.
for (const route of manifest.endpoints ?? []) {
  app.all(route.pattern, async (c) => {
    const mod = endpoints[route.id];
    try {
      const out = await runEndpoint(mod, contextFor(route, c), c.req.method);
      if (out) return out;
      return c.text(`${c.req.method} not allowed`, 405, {
        Allow: endpointMethods(mod).join(', '),
      });
    } catch (err) {
      return internalError(c, err);
    }
  });
}

// Prerendered pages. /about and /about/ are the same page.
app.get('*', (c, next) => {
  const page = statics.get(c.req.path);
  return page ? send(c, page, REVALIDATE) : next();
});

/**
 * Every route, not only the ones the build could not enumerate.
 *
 * A prerendered URL never gets here — the static handler above answered it. What
 * does get here is a URL the route matches but `paths` never listed:
 * `/people/nobody`. Leaving those to the not-found handler is what made dev and
 * production disagree — dev matched the route and rendered the page's own "not
 * found" body with a 200, production answered the 404 page. Now both render the
 * page, and the page's loader is what decides the status.
 */
for (const route of manifest.routes) {
  app.get(route.pattern, async (c) => {
    try {
      const ctx = contextFor(route, c);
      const html = await renderRoute(pages[route.id], ctx, {
        clientEntry: route.client,
        stylesheet: manifest.stylesheet,
      });

      if (html instanceof Response) return withEnvelope(html, ctx);
      return sendRendered(c, html, ctx);
    } catch (err) {
      return internalError(c, err);
    }
  });
}

const notFoundFile = path.join(dist, 'static/404.html');
const notFound = fs.existsSync(notFoundFile) ? readEntry(notFoundFile) : null;

/**
 * Read once, at startup. An error page that has to be rendered when a request
 * already failed is an error page that can fail too — this one is bytes on disk
 * by the time anything needs it.
 */
const errorFile = path.join(dist, 'static/500.html');
const errorPage = fs.existsSync(errorFile) ? readEntry(errorFile) : null;

/** Every `catch` in this file. One place decides what a failed request looks like. */
function internalError(c, err) {
  console.error(err);
  // `send` sets an ETag and a Cache-Control, which is wrong for a 500 — nothing
  // about it should be revalidated or stored, and the same bytes will be sent for
  // an unrelated failure next time.
  if (!errorPage) return c.text('Internal error', 500);

  c.header('Cache-Control', 'no-store');
  c.header('Content-Type', errorPage.type);
  return c.body(errorPage.body, 500);
}

app.notFound((c) =>
  notFound ? send(c, notFound, REVALIDATE, 404) : c.text('not found', 404),
);

/**
 * Sends the best representation the client will accept. `Vary` is not optional
 * here: without it a shared cache would serve one encoding to everyone.
 */
function send(c, entry, cacheControl, status = 200) {
  const encoding = pickEncoding(c.req.header('accept-encoding'), [...entry.encodings.keys()]);
  const chosen = encoding ? entry.encodings.get(encoding) : null;

  const body = chosen?.body ?? entry.body;
  const etag = chosen?.etag ?? entry.etag;

  c.header('Vary', 'Accept-Encoding');
  c.header('Cache-Control', cacheControl);
  c.header('ETag', etag);

  if (c.req.header('if-none-match') === etag) return c.body(null, 304);

  if (chosen) c.header('Content-Encoding', encoding);
  c.header('Content-Type', entry.type);
  c.header('Content-Length', String(body.length));
  return c.body(body, status);
}

/**
 * A response rendered for this request. There is no prebuilt variant to reach
 * for, so the ETag is computed here and the body compressed on the way out —
 * and the conditional check happens first, so a revalidating client pays for a
 * hash and nothing else.
 */
async function sendRendered(c, html, ctx = null) {
  const body = Buffer.from(html);
  const base = etagOf(body);

  const available = body.length >= COMPRESSIBLE_FLOOR ? ['br', 'gzip'] : [];
  const encoding = pickEncoding(c.req.header('accept-encoding'), available);
  const etag = encoding ? `${base.slice(0, -1)}-${encoding}"` : base;

  c.header('Vary', 'Accept-Encoding');
  c.header('Cache-Control', REVALIDATE);
  c.header('ETag', etag);

  // Whatever the loaders put on `ctx.response`, after the defaults above so a
  // page can override its own Cache-Control, and before the conditional check
  // so a 304 still carries them.
  for (const [name, value] of ctx?.response?.headers ?? []) c.header(name, value);

  if (c.req.header('if-none-match') === etag) return c.body(null, 304);

  const out = encoding ? await compressResponse(body, encoding) : body;
  if (encoding) c.header('Content-Encoding', encoding);
  c.header('Content-Type', 'text/html; charset=utf-8');
  c.header('Content-Length', String(out.length));
  return c.body(out, ctx?.response?.status ?? 200);
}

function readEntry(file) {
  const body = fs.readFileSync(file);
  const encodings = new Map();
  const etag = etagOf(body);

  for (const [encoding, suffix] of [['br', '.br'], ['gzip', '.gz']]) {
    if (!fs.existsSync(`${file}${suffix}`)) continue;
    encodings.set(encoding, {
      body: fs.readFileSync(`${file}${suffix}`),
      etag: `${etag.slice(0, -1)}-${encoding}"`,
    });
  }
  return { body, etag, encodings, type: 'text/html; charset=utf-8' };
}

/** The app every adapter listens with. */
export { app };

/**
 * What a freshly started server prints. Kept here rather than in an adapter so
 * three of them do not each grow their own copy of it.
 */
export function summary(port) {
  const kb = (n) => `${Math.round(n / 1024)} KB`;

  console.log(`http://localhost:${port}`);
  console.log(
    `  prerendered  ${statics.count} pages, ${kb(statics.bytes)}` +
      (statics.onDisk ? ` (${statics.onDisk} over budget, read per request)` : ''),
  );
  console.log(`  assets       ${assets.count} files, ${kb(assets.bytes)}`);
  console.log(
    `  precompressed ${statics.encoded + assets.encoded}/${statics.count + assets.count} resources`,
  );
  console.log(`  on demand    ${manifest.dynamic.map((r) => r.pattern).join(', ') || 'none'}`);

  if (stale) {
    const ago = Math.round((newest.time - builtAt) / 1000);
    console.log('');
    console.log(`  ⚠  ${path.relative(root, newest.file)} changed ${ago}s after the last build.`);
    console.log('     This server reads dist/, so that edit is not being served.');
    console.log('     Run `npm run build` (or `npm run preview` to do both).');
  }
}
