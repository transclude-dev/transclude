// The production app, with nothing in it that names a runtime.
//
// No `node:` imports, and a test checks that across the whole import graph. The
// moment one appears, this stops working anywhere without a filesystem, and
// nothing else would notice.
//
// What genuinely differs between runtimes is injected: where bytes come from,
// how to hash them, whether the runtime can compress. Node reads a disk and uses
// zlib; a runtime with an asset binding reads that and lets the platform compress.
// Everything below is the same either way.

import { cacheKey, createCache, windowOf } from './cache.js';
import { feed, feedPath, feedType } from './feed.js';
import { documentStore, PROXY_PATH, proxyHandler } from './proxy.js';
import { includeContext } from './include.js';
import { sitemap } from './sitemap.js';
import { PRECACHE_PATH } from './precache.js';
import { absoluteFrom } from './document.js';
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
import { pickEncoding } from './negotiate.js';
import { baseApp, endpointMethods, runEndpoint } from './server.js';
import { cookiesOf } from './cookies.js';
import { afterFor } from './after.js';

const IMMUTABLE = 'public, max-age=31536000, immutable';
const REVALIDATE = 'public, max-age=0, must-revalidate';

// One per process rather than one per render. It holds no state between calls.
const encoder = new TextEncoder();

/** Below this, the framing costs more than it saves. A 91 byte file gzips to 120. */
export const COMPRESSIBLE_FLOOR = 512;

/**
 * Sends the best representation the client will accept. `Vary` is not optional
 * here: without it a shared cache would serve one encoding to everyone.
 */
function send(c, entry, cacheControl, status = 200) {
  // The key list is built once per entry rather than per request. An entry is
  // produced at load time and never changes, so the spread was a fresh array
  // for every hit on the same file.
  entry.encodingList ??= [...entry.encodings.keys()];
  const encoding = pickEncoding(c.req.header('accept-encoding'), entry.encodingList);
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
 * What a page is going to ask for, said in a header.
 *
 * This is not streaming. Render is `__o += …` to the last component, which is
 * what lets an include resolve before it and a prerendered page stay a file,
 * and making it async would tax every component call for something most pages
 * here do not need. So the body still leaves in one piece.
 *
 * What it does buy: the stylesheet and the client entry come from the route
 * table, not from a loader, so they are known before any loader runs. A proxy
 * that reads this sends a 103 and the browser fetches them while the page is
 * still being made. Cloudflare and Fastly do. A browser reading it directly
 * gets less, since these headers arrive with the body anyway.
 */
function preloadHeader(stylesheet, clientEntry) {
  const parts = [];
  if (stylesheet) parts.push(`<${stylesheet}>; rel=preload; as=style`);
  if (clientEntry) parts.push(`<${clientEntry}>; rel=preload; as=script; crossorigin`);
  return parts.length ? parts.join(', ') : null;
}

/**
 * Whether this render can be handed to the next visitor.
 *
 * Three ways it cannot. It answered with a `Response`, it is not 2xx, or it is
 * personal. Personal means a header was written *or* a cookie was read. The
 * second half matters: a page that only reads a cookie and renders a count from
 * it sets no header at all, and holding it would hand one visitor's count to the
 * next.
 */
function isShareable(html, ctx) {
  if (html instanceof Response) return false;
  if (ctx.response.status >= 300) return false;

  const wroteHeader = [...ctx.response.headers.keys()].length > 0;
  return !wroteHeader && !ctx.cookies.personal;
}

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
 * @param {{ config: object, manifest: object, pages: Record<string, object>,
 *   endpoints?: Record<string, object>, statics?: object, assets?: object,
 *   notFound?: object|null, errorPage?: object|null, hash: Function,
 *   compress?: Function|null, publicFiles?: Function|null,
 *   middleware?: Function|null, lookup?: Function|null,
 *   precache?: string|null }} options
 * @returns {object} a Hono app, ready to serve
 */
export function createApp({
  config,
  manifest,
  pages,
  endpoints = {},
  middleware = null,
  statics = { get: () => null },
  assets = { get: () => null },
  publicFiles = null,
  notFound = null,
  errorPage = null,
  hash,
  compress = null,
  // What the build wrote to `dist/static/precache.json`, or null. It is a build
  // artifact: only the build knows an asset's hashed name, and the worker's
  // byte store answers `get` and cannot be enumerated.
  precache = null,
  // Resolving a hostname needs the runtime, and one of the four cannot do it at
  // all, so the servers that can supply this and workerd leaves it out. Without
  // it the proxy's allowlist is the whole defense.
  lookup = null,
}) {
  const cache = createCache(config.cache);

  // One resolver for the app, so several pages including the same document read
  // it once. Absent when no host is allowed, and then an external include throws
  // with the reason rather than rendering a hole.
  const include = includeContext({
    config,
    routes: manifest.routes ?? [],
    pageFor: (id) => pages[id],
    lookup,
  });

  const app = baseApp({
    csrf: config.csrf,
    csp: config.csp,
    trailingSlash: config.trailingSlash,
    publicFiles,
    middleware,
  });

  // Hashed filenames, so these are safe to cache forever.
  app.get('/assets/*', (c, next) => {
    const asset = assets.get(c.req.path);
    return asset ? send(c, asset, IMMUTABLE) : next();
  });

  /**
   * What every loader, action and endpoint is handed. `request` is the platform's
   * own `Request` rather than the server's wrapper. The framework should not be
   * the reason an author has to learn a router's API to read a form.
   */
  const contextFor = (route, c, extra = {}) => {
    const response = responseOf();
    return {
      url: c.req.url,
      params: c.req.param(),
      route: { id: route.id, pattern: route.pattern, path: c.req.path },
      request: c.req.raw,
      // The region this request asked for, or null for a whole document. An action
      // needs it to decide whether a redirect is even an answer: post/redirect/get
      // is right for a form, and wrong for a caller that asked for markup.
      fragment: regionFor(route, c),
      action: null,
      response,
      cookies: cookiesOf(c.req.raw, response, config.cookieSecret),
      absolute: absoluteFrom(config.metadataBase, c.req.url),
      revalidateTag: cache.revalidateTag,
      // Reported through `report`, so work that fails after the reader is gone
      // is not quieter than work that fails in front of them.
      after: afterFor(c, (error) => report(error, c)),
      ...extra,
    };
  };

  const header = config.fragmentHeader ?? null;

  /**
   * The region this request asked for, or undefined for the whole document.
   *
   * The query parameter is the agreement. It is written out, it can be linked to,
   * and it is strict: an unknown name is a 404, because someone typed it. A
   * header is the opposite: clients send `HX-Target` on every request, including
   * the boosted ones that want a whole document, so a name that is not a region
   * is ignored rather than refused. Guessing wrong there would break more than
   * it fixed.
   */
  function regionOf(route, c) {
    const asked = config.fragmentParam ? c.req.query(config.fragmentParam) : undefined;
    if (asked !== undefined) return asked;

    if (!header) return undefined;
    const named = c.req.header(header);
    return named && hasRegion(pages[route.id], named) ? named : undefined;
  }

  /** Same thing, as `ctx.fragment`: null rather than undefined for a document. */
  const regionFor = (route, c) => regionOf(route, c) ?? null;

  /**
   * A response that could have been a document or a region depending on a header
   * has to say so, or a shared cache will hand one to a client that wanted the
   * other.
   */
  const varyOn = header ? `Accept-Encoding, ${header}` : 'Accept-Encoding';

  // Before the route table, like the public files, so a `[...path]` catch-all
  // cannot answer for it.
  if (config.sitemap) {
    app.get('/sitemap.xml', async (c) => {
      const page = c.req.query('p');
      const xml = await sitemap(manifest, pages, config.sitemap, page ?? null);
      return c.body(xml, 200, { 'Content-Type': 'application/xml; charset=utf-8' });
    });
  }

  // A list of what the build produced, for whoever wants to cache it. The
  // framework ships nothing that reads this: a service worker is the app's, the
  // same way a swapper is.
  if (precache) {
    app.get(PRECACHE_PATH, (c) =>
      c.body(precache, 200, {
        'Content-Type': 'application/json; charset=utf-8',
        // It names the version of every file, so holding it is how a client
        // misses the build that changed them.
        'Cache-Control': 'no-cache',
      }),
    );
  }

  if (config.feed) {
    app.get(feedPath(config.feed), async (c) => {
      const xml = await feed(config.feed);
      return c.body(xml, 200, { 'Content-Type': feedType(config.feed) });
    });
  }

  // Default deny is the config's doing: no `proxy` key, no route at all, so a
  // site that never asked for one cannot be pointed at anything.
  if (config.proxy) {
    const handler = proxyHandler(config.proxy, {
      lookup: config.proxy.lookup ?? lookup ?? null,
      store: documentStore(config.proxy.cache),
    });
    app.get(PROXY_PATH, (c) => handler(c.req.raw));
  }

  /**
   * Fragments and actions come first, and for every route rather than only the
   * dynamic ones: a page whose document was prerendered still has regions worth
   * asking for and mutations worth accepting, and the prerendered handler below
   * matches on path alone, so it would answer either one with a static document.
   */
  for (const route of manifest.routes ?? []) {
    app.get(route.pattern, async (c, next) => {
      const region = regionOf(route, c);
      if (region === undefined) return next();

      try {
        const ctx = contextFor(route, c);
        const html = await renderFragment(pages[route.id], ctx, { region: region || null, include });

        if (html instanceof Response) return withEnvelope(html, ctx);
        if (html === null) return c.text(`no fragment "${region}"`, 404);
        return sendRendered(c, html, ctx);
      } catch (err) {
        return internalError(c, err);
      }
    });

    app.on(ACTION_METHODS, route.pattern, async (c) => {
      const page = pages[route.id];
      const region = regionOf(route, c);
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
            ? await renderRoute(page, ctx, {
                clientEntry: route.client,
                stylesheet: manifest.stylesheet,
                csp: config.csp,
                lang: config.lang,
                // Written by the build and carried here, so a server-rendered
                // page says the same thing about speculation that a file does.
                speculate: manifest.speculate ?? null,
                include,
              })
            : await renderFragment(page, ctx, { region: region || null, include });

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
        // The same envelope every other path gets. An endpoint that sets a
        // cookie and returns a redirect is an ordinary thing to write, and the
        // `Set-Cookie` was dropped without it.
        const ctx = contextFor(route, c);
        const out = await runEndpoint(mod, ctx, c.req.method);
        if (out) return withEnvelope(out, ctx);
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
   * A prerendered URL never gets here. The static handler above answered it.
   * What does get here is a URL the route matches but `paths` never listed:
   * `/people/nobody`. Leaving those to the not-found handler is what made dev and
   * production disagree. Dev matched the route and rendered the page's own "not
   * found" body with a 200, while production answered the 404 page. Now both render the
   * page, and the page's loader is what decides the status.
   */
  for (const route of manifest.routes ?? []) {
    const window = windowOf(pages[route.id]);
    const preload = preloadHeader(manifest.stylesheet, route.client);

    app.get(route.pattern, async (c) => {
      try {
        // The cache calls this when it needs a render and nothing calls it on a
        // hit, so what it produced is left here for the lines after. A hit
        // leaves it null, which is the difference the code below reads.
        let last = null;

        const render = async () => {
          const ctx = contextFor(route, c);
          const html = await renderRoute(pages[route.id], ctx, {
            clientEntry: route.client,
            stylesheet: manifest.stylesheet,
            csp: config.csp,
            lang: config.lang,
            speculate: manifest.speculate ?? null,
            include,
          });

          last = { ctx, html };
          return { html, cacheable: isShareable(html, ctx) };
        };

        if (!window) {
          await render();
          const { ctx, html } = last;
          if (html instanceof Response) return withEnvelope(html, ctx);
          return sendRendered(c, html, ctx, preload);
        }

        const html = await cache.read(cacheKey(c.req.url), window, render);

        // A miss rendered through the cache, and that render can answer with a
        // `Response`. It was not stored, but it is still the answer.
        if (html instanceof Response) return withEnvelope(html, last.ctx);

        // A hit ran no loader, so there is no envelope to carry: a page with a
        // header was never stored. It still needs a context to send with.
        const ctx = last ? last.ctx : contextFor(route, c);
        return sendRendered(c, html, ctx, preload);
      } catch (err) {
        return internalError(c, err);
      }
    });
  }

  app.notFound((c) => (notFound ? send(c, notFound, REVALIDATE, 404) : c.text('not found', 404)));

  /**
   * Where a failed request is reported.
   *
   * `console.error` is the default and not much of one: a real site sends this
   * to something that can page a person. `onError` is that seam, and it is given
   * the request as well, because an error with no URL and no method is most of
   * the way to useless.
   *
   * It is called inside a `try`. A reporter that throws would otherwise replace
   * the error being reported, which is the one failure mode a reporting hook
   * must not have.
   */
  function report(err, c) {
    if (typeof config.onError !== 'function') {
      console.error(err);
      return;
    }
    try {
      config.onError(err, { request: c.req.raw, url: c.req.url, method: c.req.method });
    } catch (failed) {
      console.error(err);
      console.error('[transclude] onError itself threw:', failed);
    }
  }

  /** Every `catch` above. One place decides what a failed request looks like. */
  function internalError(c, err) {
    report(err, c);
    // No ETag and no Cache-Control: nothing about a failure should be stored or
    // revalidated, and the same bytes would be sent for an unrelated one next time.
    if (!errorPage) return c.text('Internal error', 500);

    c.header('Cache-Control', 'no-store');
    c.header('Content-Type', errorPage.type);
    return c.body(errorPage.body, 500);
  }

  /**
   * A response rendered for this request. There is no prebuilt variant to reach
   * for, so the ETag is computed here and the body is compressed on the way out.
   * The conditional check happens first, so a revalidating client pays for a hash
   * and nothing else.
   *
   * `TextEncoder` rather than `Buffer`: the latter is Node's, and this file is not.
   */
  async function sendRendered(c, html, ctx = null, preload = null) {
    // Before the body is even built: a proxy that understands this turns it into
    // a 103, and the browser starts the stylesheet while the loader is still
    // waiting. Set here rather than on `ctx.response`, because a header there is
    // one of the things that makes a page too personal to cache.
    if (preload) c.header('Link', preload);

    const body = encoder.encode(html);
    const base = await hash(body);

    const available = compress && body.length >= COMPRESSIBLE_FLOOR ? ['br', 'gzip'] : [];
    const encoding = pickEncoding(c.req.header('accept-encoding'), available);
    const etag = encoding ? `${base.slice(0, -1)}-${encoding}"` : base;

    c.header('Vary', varyOn);
    c.header('Cache-Control', REVALIDATE);
    c.header('ETag', etag);

    // Whatever the loaders put on `ctx.response`, after the defaults above so a
    // page can override its own Cache-Control, and before the conditional check
    // so a 304 still carries them.
    for (const [name, value] of ctx?.response?.headers ?? []) c.header(name, value);

    if (c.req.header('if-none-match') === etag) return c.body(null, 304);

    const out = encoding ? await compress(body, encoding) : body;
    if (encoding) c.header('Content-Encoding', encoding);
    c.header('Content-Type', 'text/html; charset=utf-8');
    c.header('Content-Length', String(out.length));
    return c.body(out, ctx?.response?.status ?? 200);
  }

  return app;
}
