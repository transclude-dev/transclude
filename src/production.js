// The Node wiring for the production app.
//
// `app.js` is the app, and it names no runtime. This file is the four things that
// do: bytes off a disk, a hash from `node:crypto`, compression from `node:zlib`,
// and Hono's Node `serveStatic` for the public directory. That last one is kept
// separate because it does byte ranges, which an in-memory map cannot.
//
// A runtime with no filesystem writes its own version of this file. It is about
// thirty lines, and `app.js` does not change.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from './app.js';
import { etagOf, loadAssets, loadStatic } from './static-cache.js';
import { compressResponse } from './compress.js';
import { loadProject, portOf } from './project.js';
import { nodeLookup } from './lookup.js';

const { root, config, configFile } = await loadProject();
const dist = path.join(root, config.outDir);

export const port = portOf(config, process.env.PORT);

export const noBuild = !fs.existsSync(path.join(dist, 'routes.json'));

/**
 * This server reads `dist`, never the source. An edit made since the last build
 * is not visible here, which looks the same as the edit not working, so say so
 * rather than leave it to be found.
 */
function newestSource() {
  // The app, and the framework wherever it is installed. `fileURLToPath`, not
  // `url.pathname`: a space in the path stays percent-encoded in the latter, and
  // `Atelier%20Dakroub` is not a directory.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const roots = [path.join(root, config.appDir), here];
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
  if (fs.existsSync(configFile)) {
    const { mtimeMs } = fs.statSync(configFile);
    if (mtimeMs > newest.time) newest = { time: mtimeMs, file: configFile };
  }
  return newest;
}

const builtAt = noBuild ? 0 : fs.statSync(path.join(dist, 'routes.json')).mtimeMs;
const newest = newestSource();
const stale = !noBuild && newest.time > builtAt;

const manifest = noBuild
  ? { routes: [], dynamic: [], endpoints: [] }
  : JSON.parse(fs.readFileSync(path.join(dist, 'routes.json'), 'utf8'));

const bundle = noBuild
  ? { pages: {}, endpoints: {}, middleware: null }
  : await import(pathToFileURL(path.join(dist, 'server/entry.js')).href);

const assets = loadAssets(path.join(dist, 'client'));
const statics = loadStatic(path.join(dist, 'static'));

/** A page the framework reaches for rather than routes to. */
const readPage = (name) => {
  const file = path.join(dist, 'static', name);
  return fs.existsSync(file) ? readEntry(file) : null;
};

const publicRoot = path.join(dist, 'public');

export const app = createApp({
  config,
  lookup: config.proxy ? nodeLookup() : null,
  manifest,
  pages: bundle.pages,
  endpoints: bundle.endpoints ?? {},
  middleware: bundle.middleware ?? null,
  statics,
  assets,
  // `serveStatic` joins `root` onto the request path, so it resolves against the
  // working directory. This file works from its own location so it does not depend
  // on where the process was started.
  publicFiles: fs.existsSync(publicRoot)
    ? serveStatic({ root: relativeToCwd(publicRoot), precompressed: true })
    : null,
  notFound: readPage('404.html'),
  errorPage: readPage('500.html'),
  hash: etagOf,
  compress: compressResponse,
});

/**
 * What a freshly started server prints. Kept here rather than in an adapter so
 * three of them do not each grow their own copy of it.
 *
 * @param {number} port
 * @returns {void}
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
    const where = path.relative(root, newest.file);
    console.log(`  ⚠  ${where} changed ${ago}s after the last build.`);
    console.log('     This server reads dist/, so that edit is not being served.');
    console.log('     Run `npm run build` (or `npm run preview` to do both).');
  }
}

function relativeToCwd(absolute) {
  const relative = path.relative(process.cwd(), absolute);
  return relative === '' ? '.' : relative;
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
