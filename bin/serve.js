// Production server. No Vite, no compiler — everything it serves was decided at
// build time. Prerendered HTML first, then whatever is left to render on demand.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import {
  ACTION_METHODS,
  hasRegion,
  methodsOf,
  renderFragment,
  renderRoute,
  runAction,
} from '../src/document.js';
import { etagOf, loadAssets, loadStatic } from '../src/static-cache.js';
import { pickEncoding } from '../src/negotiate.js';
import { COMPRESSIBLE_FLOOR, compressResponse } from '../src/compress.js';
import config from '../../html-first.config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dist = path.join(root, config.outDir);
const PORT = Number(process.env.PORT ?? 3000);

if (!fs.existsSync(path.join(dist, 'routes.json'))) {
  console.error('No build found. Run `npm run build` first.');
  process.exit(1);
}

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
const { pages } = await import(pathToFileURL(path.join(dist, 'server/entry.js')).href);

const assets = loadAssets(path.join(dist, 'client'));
const statics = loadStatic(path.join(dist, 'static'));

const IMMUTABLE = 'public, max-age=31536000, immutable';
const REVALIDATE = 'public, max-age=0, must-revalidate';

const app = new Hono({ strict: false });

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
  ...extra,
});

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
      const html = await renderFragment(pages[route.id], contextFor(route, c), {
        region: region || null,
      });
      if (html === null) return c.text(`no fragment "${region}"`, 404);
      return sendRendered(c, html);
    } catch (err) {
      console.error(err);
      return c.text('Internal error', 500);
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

      const outcome = await runAction(page, contextFor(route, c), c.req.method);
      if (!outcome) {
        return c.text(`${c.req.method} not allowed`, 405, { Allow: methodsOf(page).join(', ') });
      }
      if (outcome.response) return outcome.response;

      const ctx = contextFor(route, c, { action: outcome.action });
      const html =
        region === undefined
          ? await renderRoute(page, ctx, { clientEntry: route.client, stylesheet: manifest.stylesheet })
          : await renderFragment(page, ctx, { region: region || null });

      return sendRendered(c, html);
    } catch (err) {
      console.error(err);
      return c.text('Internal error', 500);
    }
  });
}

// Prerendered pages. /about and /about/ are the same page.
app.get('*', (c, next) => {
  const page = statics.get(c.req.path);
  return page ? send(c, page, REVALIDATE) : next();
});

// Everything the build could not enumerate.
for (const route of manifest.dynamic) {
  app.get(route.pattern, async (c) => {
    try {
      const html = await renderRoute(pages[route.id], contextFor(route, c), {
        clientEntry: route.client,
        stylesheet: manifest.stylesheet,
      });
      return sendRendered(c, html);
    } catch (err) {
      console.error(err);
      return c.text('Internal error', 500);
    }
  });
}

const notFoundFile = path.join(dist, 'static/404.html');
const notFound = fs.existsSync(notFoundFile) ? readEntry(notFoundFile) : null;

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
async function sendRendered(c, html) {
  const body = Buffer.from(html);
  const base = etagOf(body);

  const available = body.length >= COMPRESSIBLE_FLOOR ? ['br', 'gzip'] : [];
  const encoding = pickEncoding(c.req.header('accept-encoding'), available);
  const etag = encoding ? `${base.slice(0, -1)}-${encoding}"` : base;

  c.header('Vary', 'Accept-Encoding');
  c.header('Cache-Control', REVALIDATE);
  c.header('ETag', etag);

  if (c.req.header('if-none-match') === etag) return c.body(null, 304);

  const out = encoding ? await compressResponse(body, encoding) : body;
  if (encoding) c.header('Content-Encoding', encoding);
  c.header('Content-Type', 'text/html; charset=utf-8');
  c.header('Content-Length', String(out.length));
  return c.body(out);
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

serve({ fetch: app.fetch, port: PORT }, ({ port }) => {
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
});
