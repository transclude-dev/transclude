// Hono routes; Vite compiles. The route table is the directory tree — see
// src/routes.js for the conventions.

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { getRequestListener } from '@hono/node-server';
import { createServer as createViteServer } from 'vite';
import { renderRoute, renderFragment } from '../src/document.js';
import { clientEntryUrl, pageModuleId } from '../src/plugin.js';
import { scanRoutes } from '../src/routes.js';
import config from '../../html-first.config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pagesDir = path.join(root, config.appDir, config.pagesDir);
const PORT = Number(process.env.PORT ?? 5173);

const vite = await createViteServer({
  root,
  appType: 'custom',
  server: { middlewareMode: true },
});

const renderPage = async (route, c, status = 200) => {
  const page = await vite.ssrLoadModule(pageModuleId(route.id));

  const ctx = {
    url: c.req.url,
    // Only ask Hono for params when the route declares them: on the not-found
    // path nothing matched, and c.req.param() has no stash to read.
    params: route.params.length ? c.req.param() : {},
    route: { id: route.id, pattern: route.pattern, path: c.req.path },
    req: c.req,
  };

  const html = await renderRoute(page, ctx, {
    clientEntry: page.client.needed ? clientEntryUrl(route.id) : null,
    // No query param: Vite content-negotiates, and a <link> sends
    // `Accept: text/css`, so the plain path returns the stylesheet.
    stylesheet: config.stylesheet ? `/${config.stylesheet}` : null,
  });
  return c.html(await vite.transformIndexHtml(c.req.path, html), status);
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

const sendFragment = async (route, c, region) => {
  const page = await vite.ssrLoadModule(pageModuleId(route.id));
  const html = await renderFragment(
    page,
    {
      url: c.req.url,
      params: route.params.length ? c.req.param() : {},
      route: { id: route.id, pattern: route.pattern, path: c.req.path },
      req: c.req,
    },
    { region: region || null },
  );

  if (html === null) return c.text(`no fragment "${region}" on ${route.rel}`, 404);
  // No Vite transform: a fragment is inserted into a document that already ran
  // the client entry, and injecting the HMR preamble again would run it twice.
  return c.html(html);
};

const onError = (c, err) => {
  vite.ssrFixStacktrace(err);
  console.error(err);
  return c.text(`${err.name}: ${err.message}\n\n${err.stack ?? ''}`, 500);
};

function buildApp() {
  const { routes, notFound } = scanRoutes(pagesDir);

  // strict: false so /about and /about/ are the same page.
  const app = new Hono({ strict: false });

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
    `[routes]\n${routes.map((r) => `  ${r.pattern.padEnd(24)} ${r.rel}`).join('\n')}` +
      (notFound ? `\n  ${'(not found)'.padEnd(24)} ${notFound.rel}` : ''),
  );

  return app;
}

let app = buildApp();

// Adding or removing a page changes the route table, not just a module.
vite.watcher.on('all', (event, file) => {
  if (event === 'change' || !file.startsWith(pagesDir) || !file.endsWith('.html')) return;
  try {
    app = buildApp();
  } catch (err) {
    console.error(err.message);
  }
});

const hono = getRequestListener((request) => app.fetch(request));

// Vite owns /@id/, /@vite/client and /src/*; Hono gets everything else.
http
  .createServer((req, res) => {
    vite.middlewares(req, res, () => hono(req, res));
  })
  .listen(PORT, () => {
    console.log(`http://localhost:${PORT}`);
  });
