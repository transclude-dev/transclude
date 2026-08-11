#!/usr/bin/env node
// Hono routes; Vite compiles. The route table is the directory tree. See
// src/routes.js for the rules.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { getRequestListener } from '@hono/node-server';
import { publicFiles as publicHandler } from '../src/public-files.js';
import { buildSprite, readLibraries, refuseSpriteClash } from '../src/icons.js';
import { createServer as createViteServer } from 'vite';
import {
  ACTION_METHODS,
  hasRegion,
  absoluteFrom,
  methodsOf,
  renderFragment,
  renderRoute,
  responseOf,
  runAction,
  runGuards,
  withEnvelope,
} from '../src/document.js';
import transclude, { clientEntryUrl, pageModuleId } from '../src/plugin.js';
import { resolveRoutesDir, scanRoutes } from '../src/routes.js';
import { MARKDOWN_EXT } from '../src/markdown.js';
import { baseApp, endpointMethods, runEndpoint, SERVER_FILE } from '../src/server.js';
import { randomBytes } from 'node:crypto';
import { cookiesOf } from '../src/cookies.js';
import { loadProject, portOf } from '../src/project.js';
import { includeContext } from '../src/include.js';
import { nodeLookup } from '../src/lookup.js';
import { feed, feedPath, feedType } from '../src/feed.js';
import { sitemap } from '../src/sitemap.js';
import { documentStore, PROXY_PATH, proxyHandler } from '../src/proxy.js';
import { afterFor } from '../src/after.js';

const { root, config } = await loadProject();
const routesDir = resolveRoutesDir(path.join(root, config.appDir), config.routesDir);
const PORT = portOf(config, process.env.PORT);

// Built the same way the production server and the build build theirs. Dev used
// to get only half of it, so a route include worked in production and threw
// here.
let include = null;

/**
 * A signing secret for this process only, when the config has none.
 *
 * Dev, and dev alone. Signed cookies stop working across a restart, which is a
 * fair price for a fresh clone that runs. Production does *not* do this: a server
 * that invents a secret invalidates every session whenever it restarts and shares
 * none with a second instance, and finding that out in production is worse than
 * being told at the first signed cookie.
 */
const cookieSecret = config.cookieSecret ?? randomBytes(32).toString('hex');
if (!config.cookieSecret) {
  console.log('[transclude] no cookieSecret, so signing with a random one for this process');
}

const publicRoot = config.publicDir
  ? path.join(root, config.appDir, config.publicDir)
  : null;

// The same handler production mounts, over the source directory rather than the
// copy in dist. Not `precompressed`: nothing has written a .br next to these yet.
const publicFiles =
  publicRoot && fs.existsSync(publicRoot)
    ? publicHandler(path.relative(process.cwd(), publicRoot) || '.')
    : null;

const iconsRoot = config.iconsDir ? path.join(root, config.appDir, config.iconsDir) : null;

/**
 * One library's sprite, built per request rather than read off disk.
 *
 * Reading a directory of small files on every request is what the rest of dev
 * already does, and it is what makes adding an icon show up on reload. A refusal
 * is returned as text rather than thrown, so a missing viewBox reads the same
 * here as the message that would stop the build.
 *
 * A name no library answers to is a 404, not an empty sprite. `/lucdie.svg` is a
 * typo, and a blank icon is a worse way to find that out than a missing file.
 */
function sprite(name) {
  try {
    const libraries = readLibraries(iconsRoot, root);
    refuseSpriteClash(publicRoot, libraries);

    const library = libraries.find((entry) => entry.name === name);
    if (!library) {
      const known = libraries.map((entry) => entry.name).join(', ') || 'none';
      return {
        status: 404,
        type: 'text/plain; charset=utf-8',
        body: `no icon library "${name}". There is: ${known}`,
      };
    }

    return {
      status: 200,
      type: 'image/svg+xml; charset=utf-8',
      body: buildSprite(library.icons),
    };
  } catch (error) {
    return { status: 500, type: 'text/plain; charset=utf-8', body: error.message };
  }
}

// Built before Vite, because Vite needs it: in middleware mode with no `hmr`
// option Vite starts its own WebSocket server on another port, the browser
// refuses that socket as cross-origin, and every edit needs a manual reload.
// Handing it this server puts the socket on the same origin as the page.
const server = http.createServer();

const vite = await createViteServer({
  root,
  appType: 'custom',
  // Passed here rather than left to the project's own `vite.config.js`, which is
  // where dev used to get it. A project needs no Vite config at all, and the one
  // built here is the one `loadProject` filled in, so dev compiles against the
  // same config the build does. `configResolved` ignores a second registration.
  plugins: [transclude(config)],
  server: { middlewareMode: true, hmr: { server } },
  // Vite would serve these itself, ahead of Hono, and production would serve
  // them a different way, which is how dev and production come to disagree. One
  // way instead: `baseApp` mounts Hono's static middleware in both.
  publicDir: false,
});

/**
 * What every loader and action is handed. `request` is the platform's own
 * `Request` rather than the server's wrapper. The framework should not be the
 * reason an author has to learn a router's API to read a form.
 */
const contextFor = (route, c, extra = {}) => ({
  url: c.req.url,
  // Only ask Hono for params when the route declares them: on the not-found
  // path nothing matched, and c.req.param() has no stash to read.
  params: route.params.length ? c.req.param() : {},
  route: { id: route.id, pattern: route.pattern, path: c.req.path },
  request: c.req.raw,
  // The region this request asked for, or null for a whole document. An action
  // needs it to decide whether a redirect is even an answer: post/redirect/get
  // is right for a form, and wrong for a caller that asked for markup.
  fragment: fragmentOf(c),
  action: null,

  // Nothing is held between requests here, so there is nothing to drop. A
  // no-op rather than an omission: an action calling this is correct code, and
  // it should not throw in dev and work in production.
  revalidateTag: () => {},

  // Node keeps running after a response, so this only has to handle the
  // rejection. `console.error` rather than `config.onError`, which the dev
  // server does not use for anything else either.
  after: afterFor(c, (error) => console.error('[transclude] ctx.after:', error)),

  ...withResponse(c, extra),
});

/**
 * The envelope and the cookies that write into it, built together. The cookie
 * helpers hold the same `response` the server will read, so a `set` in a loader
 * lands on the way out.
 */
function withResponse(c, extra) {
  const response = responseOf();
  return {
    response,
    cookies: cookiesOf(c.req.raw, response, cookieSecret),
    absolute: absoluteFrom(config.metadataBase, c.req.url),
    ...extra,
  };
}

/** Whatever the loaders and actions put on `ctx.response`, on the way out. */
const sendWith = (c, { response }, html, status) => {
  for (const [name, value] of response.headers) c.header(name, value);
  return c.html(html, status ?? response.status);
};

const renderPage = async (route, c, status = null, extra = {}) => {
  const page = await vite.ssrLoadModule(pageModuleId(route.id));
  const ctx = contextFor(route, c, extra);

  const html = await renderRoute(page, ctx, {
    clientEntry: page.client.needed ? clientEntryUrl(route.id) : null,
    // No query param: Vite content-negotiates, and a <link> sends
    // `Accept: text/css`, so the plain path returns the stylesheet.
    stylesheet: config.stylesheet ? `/${config.stylesheet}` : null,
    csp: config.csp,
    lang: config.lang,
    include,
  });
  // A loader answered for itself: a redirect, or something that is not a page.
  if (html instanceof Response) return withEnvelope(html, ctx);

  return sendWith(c, ctx, await vite.transformIndexHtml(c.req.path, html), status);
};

/**
 * The region this request is asking for, or null for the whole document. An
 * empty value (`?fragment`) is the page's own body without its layouts.
 */
const fragmentOf = (c) => {
  if (!config.fragmentParam) return null;
  const value = c.req.query(config.fragmentParam);
  return value === undefined ? null : value;
};

const sendFragment = async (route, c, region, extra = {}) => {
  const page = await vite.ssrLoadModule(pageModuleId(route.id));
  const ctx = contextFor(route, c, extra);
  const html = await renderFragment(page, ctx, { region: region || null, include });

  if (html instanceof Response) return withEnvelope(html, ctx);
  if (html === null) return c.text(`no fragment "${region}" on ${route.rel}`, 404);
  // No Vite transform: a fragment is inserted into a document that already ran
  // the client entry, and injecting the HMR preamble again would run it twice.
  return sendWith(c, ctx, html);
};

/**
 * A form submission, or anything else that is not a GET.
 *
 * The layouts answer first, then the action, then the request is answered the
 * same way a GET is: the whole document, or one region if the URL asked for one.
 * That last part is what regions are for. POST a form to `?fragment=list` and
 * what comes back is the list, already rendered, by the same compiled region the
 * page uses.
 */
const handleAction = async (route, c) => {
  const page = await vite.ssrLoadModule(pageModuleId(route.id));
  const region = fragmentOf(c);

  // Before the action, not after: a request nobody can answer should not have
  // mutated anything on its way to saying so.
  if (region !== null && !hasRegion(page, region)) {
    return c.text(`no fragment "${region}" on ${route.rel}`, 404);
  }

  const ctx = contextFor(route, c);

  // The layouts answer before the handler does, exactly as production does it.
  // A guard that only stopped the render would let the mutation happen and then
  // send its redirect, which is the same response a stopped request gets.
  const refused = await runGuards(page, ctx);
  if (refused) return withEnvelope(refused, ctx);

  const outcome = await runAction(page, ctx, c.req.method);

  if (!outcome) {
    return c.text(`${c.req.method} not allowed on ${route.rel}`, 405, {
      Allow: methodsOf(page).join(', '),
    });
  }
  if (outcome.response) return withEnvelope(outcome.response, ctx);

  const extra = { action: outcome.action, cookies: ctx.cookies, response: ctx.response };
  return region === null
    ? renderPage(route, c, 200, extra)
    : sendFragment(route, c, region, extra);
};

const onError = (c, err) => {
  // Before anything reads the stack: Vite's transform means the raw one points
  // at generated code, and a reporter given that is worse than none.
  vite.ssrFixStacktrace(err);
  console.error(err);

  // The same seam production has, so a reporter is exercised while you are the
  // one looking at it rather than first on a live site.
  if (typeof config.onError === 'function') {
    try {
      config.onError(err, { request: c.req.raw, url: c.req.url, method: c.req.method });
    } catch (failed) {
      console.error('[transclude] onError itself threw:', failed);
    }
  }

  return c.text(`${err.name}: ${err.message}\n\n${err.stack ?? ''}`, 500);
};

const serverFile = path.join(root, config.appDir, SERVER_FILE);

/**
 * The app's own middleware, through Vite so an edit to it is picked up the same
 * way an edit to a page is. Production gets the same module out of the SSR
 * bundle instead, because that server reads `dist` and nothing else.
 *
 * Invalidated first, and not for tidiness: the watcher below and Vite's own
 * invalidation are separate handlers on the same event, and if this runs before
 * Vite's, `ssrLoadModule` hands back the module as it was. Measured: the first
 * edit was ignored and the second appeared to work.
 */
async function loadMiddleware() {
  if (!fs.existsSync(serverFile)) return null;

  const url = `/${config.appDir}/${SERVER_FILE}`;
  // Vite's second argument is `ssr`. This module is only ever loaded through
  // `ssrLoadModule`, so the SSR graph is the one holding it.
  const ssr = true;
  const node = await vite.moduleGraph.getModuleByUrl(url, ssr);
  if (node) vite.moduleGraph.invalidateModule(node);

  const mod = await vite.ssrLoadModule(url);
  return mod.default ?? null;
}

async function buildApp() {
  const { routes, endpoints, notFound } = scanRoutes(routesDir);

  include = includeContext({
    config,
    routes,
    pageFor: (id) => vite.ssrLoadModule(pageModuleId(id)),
    lookup: nodeLookup(),
  });
  const app = baseApp({
    csrf: config.csrf,
    trailingSlash: config.trailingSlash,
    publicFiles,
    middleware: await loadMiddleware(),
  });

  // A public file at this URL is refused rather than raced, so registering after
  // `baseApp` costs nothing: the public handler can only fall through to here.
  if (iconsRoot) {
    // Any `/name.svg` at the root, because a library is named by a directory the
    // author made and dev has no list of them until it reads the disk. The public
    // handler ran first, so an .svg the author wrote still wins.
    app.get('/:file{[^/]+\\.svg}', (c) => {
      const name = c.req.param('file').slice(0, -'.svg'.length);
      const { status, type, body } = sprite(name);
      return c.body(body, status, { 'content-type': type });
    });
  }

  // Before the route table, the same way production registers them, so a
  // catch-all route cannot answer for one of these.
  //
  // They were missing here entirely. `createApp` mounts them and the dev server
  // builds its own app, so `/feed.xml` and `/sitemap.xml` were 404 in dev and
  // correct in the build. That is the worst shape a difference can take: the
  // thing you check by hand is the thing that was never wired.
  if (config.sitemap) {
    app.get('/sitemap.xml', async (c) => {
      // Only a parameter route ever reads its module, for `paths`. Loading the
      // rest would compile the whole site to answer one request.
      const pages = {};
      for (const route of routes) {
        if (route.params.length) pages[route.id] = await vite.ssrLoadModule(pageModuleId(route.id));
      }

      const xml = await sitemap({ routes }, pages, config.sitemap, c.req.query('p') ?? null);
      return c.body(xml, 200, { 'Content-Type': 'application/xml; charset=utf-8' });
    });
  }

  if (config.feed) {
    app.get(feedPath(config.feed), async (c) => {
      const xml = await feed(config.feed);
      return c.body(xml, 200, { 'Content-Type': feedType(config.feed) });
    });
  }

  // The browser calls this one, so a page using an external include worked in
  // the build and 404ed here. Default deny is the config's doing either way: no
  // `proxy` key, no route.
  //
  // `/precache.json` is deliberately not here. It names hashed asset filenames,
  // which only the build knows, and a service worker holding anything in dev is
  // a bug rather than a feature. It is build output and stays that way.
  if (config.proxy) {
    const handler = proxyHandler(config.proxy, {
      lookup: config.proxy.lookup ?? nodeLookup(),
      store: documentStore(config.proxy.cache),
    });
    app.get(PROXY_PATH, (c) => handler(c.req.raw));
  }

  // Already ordered most-specific first, so registration order is deterministic
  // rather than something to reason about per-router.
  for (const route of routes) {
    app.get(route.pattern, async (c) => {
      try {
        const fragment = fragmentOf(c);
        return fragment === null ? await renderPage(route, c) : await sendFragment(route, c, fragment);
      } catch (err) {
        return onError(c, err);
      }
    });

    // Registered for every route rather than only the ones with an action, so
    // a POST to a page that has none is a 405 with an `Allow` header instead of
    // the not-found page. The URL exists, the method does not.
    app.on(ACTION_METHODS, route.pattern, async (c) => {
      try {
        return await handleAction(route, c);
      } catch (err) {
        return onError(c, err);
      }
    });
  }

  // `app.all`, because "every verb" is the point: the module decides which it
  // answers, and anything it does not is a 405 rather than a 404.
  for (const route of endpoints) {
    const url = '/' + path.relative(root, route.file).split(path.sep).join('/');
    app.all(route.pattern, async (c) => {
      try {
        const mod = await vite.ssrLoadModule(url);
        // The same envelope every other path gets. An endpoint that sets a
        // cookie and returns a redirect is an ordinary thing to write, and the
        // `Set-Cookie` was dropped without it.
        const ctx = contextFor(route, c);
        const out = await runEndpoint(mod, ctx, c.req.method);
        if (out) return withEnvelope(out, ctx);
        return c.text(`${c.req.method} not allowed on ${route.rel}`, 405, {
          Allow: endpointMethods(mod).join(', '),
        });
      } catch (err) {
        return onError(c, err);
      }
    });
  }

  app.notFound(async (c) => {
    if (!notFound) return c.text('not found', 404);
    try {
      return await renderPage(notFound, c, 404);
    } catch (err) {
      return onError(c, err);
    }
  });

  console.log(
    `[routes]\n${[...routes, ...endpoints].map((r) => `  ${r.pattern.padEnd(24)} ${r.rel}`).join('\n')}` +
      (notFound ? `\n  ${'(not found)'.padEnd(24)} ${notFound.rel}` : ''),
  );

  return app;
}

let app = await buildApp();

// Adding or removing a page changes the route table, not just a module.
vite.watcher.on('all', async (event, file) => {
  // `.js` as well as `.html`: an endpoint is a route too, and watching only for
  // pages meant adding one needed a restart, with a 404 as the only hint. `.md`
  // for the same reason: a Markdown page is a page.
  const extension = path.extname(file);
  const routing =
    file.startsWith(routesDir) &&
    (extension === '.html' || extension === MARKDOWN_EXT || extension === '.js') &&
    event !== 'change';
  // Middleware is registered once when the app is built, so a change to it needs
  // the app rebuilt, unlike a page, which is loaded per request.
  if (!routing && file !== serverFile) return;
  try {
    app = await buildApp();
  } catch (err) {
    console.error(err.message);
  }
});

const hono = getRequestListener((request) => app.fetch(request));

// Vite owns /@id/, /@vite/client and /src/*; Hono gets everything else.
server.on('request', (req, res) => {
  vite.middlewares(req, res, () => hono(req, res));
});

server.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});
