#!/usr/bin/env node
// Production build.
//
//   dist/client   hashed, minified client entries, one per route that needs JS
//   dist/server   the SSR bundle, plain ESM, no Vite at runtime
//   dist/static   prerendered HTML for every route whose URLs are knowable
//   dist/routes.json  what is left for the server to render on demand
//
// Page and layout CSS is inlined into <head> by the document assembler, and
// component CSS lives inside each shadow root, so there are no stylesheet
// assets to emit or link.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import transclude from '../src/plugin.js';
import { loadProject } from '../src/project.js';
import { renderRoute, urlFor } from '../src/document.js';
import { prerenderContext, refusePrerender } from '../src/prerender.js';
import { isGated, readGated, unmatched } from '../src/gate.js';
import { feed, feedPath } from '../src/feed.js';
import { includeContext } from '../src/include.js';
import { nodeLookup } from '../src/lookup.js';
import { sitemap } from '../src/sitemap.js';
import { etagOf, loadAssets, loadStatic } from '../src/static-cache.js';
import { buildSprite, readLibraries, refuseSpriteClash, spritePath } from '../src/icons.js';
import { PRECACHE_PATH, precacheDocument, precacheList } from '../src/precache.js';
import { speculateSettings, speculationRules } from '../src/speculate.js';
import { pool } from '../src/pool.js';
import { mappedFrames } from '../src/stack.js';
import { precompress } from '../src/compress.js';
import { known, typeOf } from '../src/mime.js';
import { loadVite } from '../src/vite.js';

const { root, config } = await loadProject();
// After the config, so an app with neither hears about the config first.
const { build } = await loadVite();
const dist = path.join(root, config.outDir);

const plugin = transclude(config);
plugin.api.configure({ root });
const manifest = plugin.api.manifest();

fs.rmSync(dist, { recursive: true, force: true });

// ---- client ---------------------------------------------------------------

// `needed` is decided in the plugin, which is also what the dev server asks. Two
// copies of that rule is two servers that disagree about which pages ship JS.
const clientRoutes = [...manifest.routes, manifest.notFound, manifest.error]
  .filter(Boolean)
  .filter((route) => route.client.needed);

const assets = new Map();

// A prerendered page reads its sources once, here, and carries the result. That
// is the whole reason includes are resolved before the render rather than during
// it: a page written to a file cannot fetch anything later.
const include = includeContext({
  config,
  routes: manifest.routes ?? [],
  pageFor: (id) => pages[id],
  lookup: nodeLookup(),
});
let stylesheet = null;

const clientInput = Object.fromEntries(
  clientRoutes.map((route) => [route.id, `virtual:transclude-client/${route.id}`]),
);
// The site stylesheet is an entry of its own, so Vite processes it and rollup
// hashes it. One cacheable file shared by every page.
if (config.stylesheet) clientInput.__global = path.join(root, config.stylesheet);

if (Object.keys(clientInput).length) {
  const output = await build({
    root,
    logLevel: 'warn',
    plugins: [transclude(config)],
    // Copied once, here, into dist/public. Vite would otherwise put a copy in both
    // the client and the SSR output, and neither is where it is served from.
    publicDir: false,
    build: {
      outDir: `${config.outDir}/client`,
      emptyOutDir: true,
      rollupOptions: { input: clientInput },
    },
  });

  const chunks = (Array.isArray(output) ? output[0] : output).output;
  for (const chunk of chunks) {
    if (chunk.type === 'asset' && chunk.fileName.endsWith('.css')) {
      stylesheet = `/${chunk.fileName}`;
      continue;
    }
    if (chunk.isEntry && chunk.name && chunk.name !== '__global') {
      assets.set(chunk.name, `/${chunk.fileName}`);
    }
  }
}

// ---- server ---------------------------------------------------------------

await build({
  root,
  logLevel: 'warn',
  plugins: [transclude(config)],
  publicDir: false,
  build: {
    outDir: `${config.outDir}/server`,
    emptyOutDir: true,
    // The map that lets a prerender failure name the .html line. The bundler
    // composes it from what the plugin's load hook returns, which is why the
    // virtual ids carry no '\0' prefix: rolldown leaves '\0' modules out.
    sourcemap: true,
    // `ssr: true` rather than a path: Vite resolves a string entry against the
    // project root before any plugin sees it, which a virtual id cannot survive.
    ssr: true,
    rollupOptions: {
      input: { entry: 'virtual:transclude-server' },
      output: { entryFileNames: '[name].js' },
    },
  },
});

// A worker entry imports this bundle, and an editor set to check the app's JS
// then checks a file nobody wrote. Twenty errors in the showcase, all of them
// about generated code. The banner is what keeps it out of that program.
const entry = path.join(dist, 'server/entry.js');
fs.writeFileSync(entry, `// @ts-nocheck\n${fs.readFileSync(entry, 'utf8')}`);

// The banner is one more line the map does not know about, so every position
// it reports would be off by one, in the direction that names the wrong line
// with full confidence. One empty group in front keeps every mapping true.
if (fs.existsSync(`${entry}.map`)) {
  const shifted = JSON.parse(fs.readFileSync(`${entry}.map`, 'utf8'));
  shifted.mappings = `;${shifted.mappings}`;
  fs.writeFileSync(`${entry}.map`, JSON.stringify(shifted));
}

// ---- prerender ------------------------------------------------------------

const { pages, gated: declared } = await import(pathToFileURL(entry).href);

/**
 * Paths `app/server.js` says are not public, and the routes they cover.
 *
 * Middleware does not run during a build, so nothing here can tell a payment
 * gate or an auth check from an open page. Without the declaration a gated page
 * is written to `dist/static` and served by any static host that finds it, and
 * the build reports it as a page it prerendered.
 *
 * An entry matching nothing is a typo, and a typo here fails open, so it is an
 * error rather than a shrug.
 */
const gated = readGated(declared);

// ---- drafts ---------------------------------------------------------------

/**
 * `export const draft = true` keeps a page out of the build.
 *
 * The dev server reads the directory, so a draft is a page there and you can
 * open it, reload it and read it on a phone. This is the only place that knows
 * the difference, and it takes the route out of the one list every step below
 * reads: nothing is prerendered for it, no pattern reaches `routes.json`, and
 * the sitemap never hears of it. In production the URL is a 404.
 *
 * Assigned back onto the manifest rather than carried alongside it. Three steps
 * below read `manifest.routes`, and a fourth added later would publish drafts
 * without anyone noticing. One list is the only version of this that stays true.
 *
 * The build says what it skipped, at the end, next to everything else it wrote.
 * A page that is missing from production and silent about it is an afternoon.
 */
const isDraft = (route) => pages[route.id]?.draft === true;
const drafts = manifest.routes.filter(isDraft);

manifest.routes = manifest.routes.filter((route) => !isDraft(route));

/**
 * A static route has one URL. A dynamic route has as many as its `paths` export
 * names, and none at all if it does not export one, in which case it stays a
 * server render.
 *
 * `export const prerender = false` is the third case: a page whose output
 * depends on something no build can know, which is almost always the query
 * string. A prerendered file is one file for every URL that resolves to it, so
 * `?q=` cannot change it.
 */
// Every URL `paths()` named, before the gate. The covers-nothing check below
// asks whether each gated entry could match anything, and a URL a gate held
// back is exactly a matched one, so the list has to be taken before filtering.
const namedByPaths = [];

async function urlsFor(route) {
  if (pages[route.id]?.prerender === false) return [];
  if (!route.params.length) {
    return isGated(route.pattern, gated) ? [] : [{ url: route.pattern, params: {} }];
  }

  const paths = pages[route.id]?.paths;
  if (typeof paths !== 'function') return [];

  const listed = (await paths()) ?? [];
  const named = listed.map((params) => ({ url: urlFor(route, params), params }));
  for (const { url } of named) namedByPaths.push(url);

  // Matched per URL, not per route: `/notes/[id]` can be open while
  // `/notes/secret` is not, and the pattern is the same for both.
  return named.filter(({ url }) => !isGated(url, gated));
}

/**
 * One page, rendered to the markup that gets written.
 *
 * What it is allowed to be, and the `ctx` it is given, are both in
 * `src/prerender.js`, where they can be tested. Nothing imports this file.
 */
async function render(route, { url, params }) {
  const ctx = prerenderContext({
    route,
    url,
    params,
    cookieSecret: config.cookieSecret,
    metadataBase: config.metadataBase,
  });

  const html = await renderRoute(pages[route.id], ctx, {
    clientEntry: assets.get(route.id) ?? null,
    stylesheet,
    csp: config.csp,
    lang: config.lang,
    canonical: config.canonical,
    speculate: speculateRules,
    include,
  });

  refusePrerender(ctx, html);
  return html;
}

const write = (relative, html) => {
  const file = path.join(dist, 'static', relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
  return relative;
};

// Ask every route for its URLs first, so the render pass is one flat list and
// can run wide rather than route by route.
const dynamic = [];
const targets = [];

for (const route of manifest.routes) {
  const urls = await urlsFor(route);
  if (!urls.length) {
    dynamic.push(route);
    continue;
  }
  for (const target of urls) targets.push({ route, target });
}

// ---- gated entries that cover nothing ---------------------------------------
//
// A typo in `gated` fails open: the entry matches nothing, the page it meant to
// hold back is written, and the build reports a success. So every entry has to
// cover something that exists: a page or endpoint pattern, a URL `paths()`
// named, or a public file, which the gate also guards at runtime.
{
  const publicDir = config.publicDir ? path.join(root, config.appDir, config.publicDir) : null;
  const files = [];
  const walk = (dir, at) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name), `${at}${entry.name}/`);
      else files.push(`${at}${entry.name}`);
    }
  };
  if (publicDir && fs.existsSync(publicDir)) walk(publicDir, '/');

  const missed = unmatched(gated, {
    patterns: [
      ...manifest.routes.map((route) => route.pattern),
      // A gated draft is a declared intent, not a typo.
      ...drafts.map((route) => route.pattern),
      ...manifest.endpoints.map((route) => route.pattern),
    ],
    urls: [...namedByPaths, ...files],
  });

  if (missed.length) {
    throw new Error(
      `[transclude] "gated" in app/server.js has ${missed.map((entry) => `"${entry}"`).join(', ')}, ` +
        `which matches no route, no URL a paths() names, and no public file. ` +
        `An entry that covers nothing fails open: the page it meant to hold back is written and served.`,
    );
  }
}

if (manifest.notFound) {
  targets.push({
    route: { ...manifest.notFound, pattern: '' },
    target: { url: '/404', params: {} },
    file: '404.html',
    label: '404.html  (not-found page)',
  });
}

if (manifest.error) {
  targets.push({
    route: { ...manifest.error, pattern: '' },
    target: { url: '/500', params: {} },
    file: '500.html',
    label: '500.html  (error page)',
  });
}

// ---- speculation rules ------------------------------------------------------
//
// Before the render, because every page carries the block and the pages are
// about to be rendered. The URLs are already known: `targets` is what will be
// written and `dynamic` is what will not, and a target that then fails to render
// fails the build rather than leaving a rule pointing at nothing.
//
// Computed once and carried in the manifest, so the server rendering the dynamic
// routes sends the same block the files carry. Two computations is two answers
// to what a browser may prerender, and only one of them was ever checked.
//
// The split is the whole point. A file has no loader left to run, so
// prerendering it is free. A server render's loader may read a cookie or count a
// view, so the browser may fetch that and not run it. The 404 and 500 pages
// carry a `file` rather than a route URL, which is what keeps them out of both.
const speculate = speculateSettings(config.speculate);
const speculateRules = speculate
  ? speculationRules(
      {
        prerendered: targets.filter((entry) => !entry.file).map((entry) => entry.target.url),
        dynamic: dynamic.map((route) => route.pattern),
      },
      speculate,
    )
  : null;

const CONCURRENCY = Number(process.env.TRANSCLUDE_BUILD_CONCURRENCY ?? 8);

const outcomes = await pool(targets, CONCURRENCY, async ({ route, target, file, label }) => {
  const rel =
    file ?? (target.url === '/' ? 'index.html' : `${target.url.replace(/^\//, '')}/index.html`);
  try {
    write(rel, await render(route, target));
    return { url: label ?? target.url, ok: true };
  } catch (err) {
    // One bad page should not take the build down without saying which.
    return { url: target.url, ok: false, error: err };
  }
});

const failures = outcomes.filter((outcome) => !outcome.ok);
const prerendered = outcomes.filter((outcome) => outcome.ok).map((outcome) => outcome.url);
// A file, like every other page. The served route answers the same document, but
// `dist/static` is meant to be servable by a host that runs none of this, and a
// site with no sitemap there would be missing one only on the host that needs it
// written down most.
if (config.sitemap) {
  write('sitemap.xml', await sitemap({ routes: manifest.routes, gated }, pages, config.sitemap));
  prerendered.push('/sitemap.xml');
}

if (config.feed) {
  const at = feedPath(config.feed);
  write(at.replace(/^\//, ''), await feed(config.feed));
  prerendered.push(at);
}

if (failures.length) {
  // Where each failure happened, in the author's file. The bundle's map is
  // read exactly: a frame on a line the map says nothing about adds no
  // position, rather than a neighbor's line with full confidence. The first
  // mapped frame outside the runtime is the author's, because a throw that
  // starts inside the runtime belongs to whatever line called it.
  const mapFile = `${entry}.map`;
  const bundleMap = fs.existsSync(mapFile) ? JSON.parse(fs.readFileSync(mapFile, 'utf8')) : null;
  const positionOf = (error) => {
    if (!bundleMap || typeof error?.stack !== 'string') return null;
    const frames = mappedFrames(error.stack, 'server/entry.js', bundleMap);
    const frame = frames.find((one) => !one.source.includes('/runtime/'));
    if (!frame) return null;
    const file = path.resolve(path.dirname(mapFile), frame.source);
    return `${path.relative(root, file)}:${frame.line}`;
  };

  console.error(`\n${failures.length} page${failures.length === 1 ? '' : 's'} failed to render:`);
  for (const failure of failures) {
    const at = positionOf(failure.error);
    console.error(`  ${failure.url}\n    ${failure.error.message}${at ? `\n    at ${at}` : ''}`);
  }
  process.exitCode = 1;
}

fs.writeFileSync(
  path.join(dist, 'routes.json'),
  JSON.stringify(
    {
      // Carried so `/sitemap.xml` at runtime leaves out what the build left out.
      // The gate itself is `app/server.js` middleware, which runs at runtime and
      // needs no help from here.
      gated,
      dynamic: dynamic.map((route) => ({
        id: route.id,
        pattern: route.pattern,
        params: route.params,
        client: assets.get(route.id) ?? null,
      })),
      // Every route, prerendered or not. A fragment is rendered on demand even
      // where the document it belongs to was written to a file at build time. Its
      // data is a request away, and its URL is a query on the same path.
      routes: manifest.routes.map((route) => ({
        id: route.id,
        pattern: route.pattern,
        params: route.params,
        client: assets.get(route.id) ?? null,
      })),
      // Never prerendered: an endpoint answers with a Response, and a file
      // cannot carry one.
      endpoints: manifest.endpoints.map((route) => ({
        id: route.id,
        pattern: route.pattern,
        params: route.params,
      })),
      notFound: manifest.notFound ? { id: manifest.notFound.id } : null,
      error: manifest.error ? { id: manifest.error.id } : null,
      stylesheet,
      // Carried rather than recomputed. The server renders the routes that are
      // not files, and those pages have to say what the files say.
      speculate: speculateRules,
    },
    null,
    2,
  ),
);

// ---- public ---------------------------------------------------------------

const publicSrc = config.publicDir
  ? path.join(root, config.appDir, config.publicDir)
  : null;
const publicOut = path.join(dist, 'public');
let publicFiles = 0;

/**
 * What an operating system leaves in a directory, which nobody put there.
 *
 * These were copied into the build and served: `/.DS_Store` answered 200 on the
 * docs site and lists every file beside it. Dotfiles are not skipped wholesale,
 * because `.well-known` is a directory people mean to publish.
 */
const JUNK = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

if (publicSrc && fs.existsSync(publicSrc)) {
  fs.cpSync(publicSrc, publicOut, {
    recursive: true,
    filter: (from) => !JUNK.has(path.basename(from)),
  });
  publicFiles = countFiles(publicOut);
}

function countFiles(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    total += entry.isDirectory() ? countFiles(path.join(dir, entry.name)) : 1;
  }
  return total;
}

// ---- icons ----------------------------------------------------------------
//
// Written into `dist/public` after the author's own files are copied there, so
// everything below that reads the directory picks the sprite up: the asset
// module a runtime with no disk imports, the precache list, and precompression.
// It is not counted as a public file, because the author did not write it.
//
// An icon named for a file the author can see is worth a stop: `buildSprite`
// throws on a missing viewBox, and the build ends there rather than shipping
// icons that render wrong.
//
// One file per library. A downloaded icon set is a directory here, so the count
// this reports is two numbers: an icon total says nothing about how much any one
// page fetches, and the sheets are what a page fetches.

const iconsSrc = config.iconsDir ? path.join(root, config.appDir, config.iconsDir) : null;
let iconCount = 0;
let libraryCount = 0;

if (iconsSrc) {
  const libraries = readLibraries(iconsSrc, root);
  refuseSpriteClash(publicSrc, libraries);

  if (libraries.length) fs.mkdirSync(publicOut, { recursive: true });

  for (const { name, icons } of libraries) {
    const file = path.join(publicOut, path.basename(spritePath(name)));
    fs.writeFileSync(file, buildSprite(icons));
    iconCount += icons.length;
  }
  libraryCount = libraries.length;
}

// ---- assets, for runtimes with no filesystem ------------------------------
//
// The Node server reads `dist` off a disk. A worker cannot, so the same bytes are
// emitted as a module it can import. Plain bytes only, with no `.br` or `.gz`. An
// edge runtime compresses for you, and shipping three copies of every file into a
// bundle with a size limit is the wrong trade.

function assetModule() {
  const encode = (map, urlFor) => {
    const out = [];
    for (const [url, entry] of map) {
      const body = entry.body ?? fs.readFileSync(entry.file);
      out.push(
        `  ${JSON.stringify(urlFor ? urlFor(url) : url)}: ` +
          `{ type: ${JSON.stringify(entry.type)}, body: ${JSON.stringify(body.toString('base64'))} },`,
      );
    }
    return `{\n${out.join('\n')}\n}`;
  };

  const publicMap = new Map();
  if (fs.existsSync(publicOut)) {
    for (const file of walkAll(publicOut)) {
      if (file.endsWith('.br') || file.endsWith('.gz')) continue;
      const url = '/' + path.relative(publicOut, file).split(path.sep).join('/');
      publicMap.set(url, { body: fs.readFileSync(file), type: typeOf(file) });
    }
  }

  const page = (name) => {
    const file = path.join(dist, 'static', name);
    if (!fs.existsSync(file)) return 'null';
    return (
      `{ type: "text/html; charset=utf-8", ` +
      `body: ${JSON.stringify(fs.readFileSync(file).toString('base64'))} }`
    );
  };

  return `// Generated by \`npm run build\`. Bytes for a runtime that cannot read a disk.
export const statics = ${encode(loadStatic(path.join(dist, 'static')).entries)};

export const assets = ${encode(loadAssets(path.join(dist, 'client')).entries)};

export const publicFiles = ${encode(publicMap)};

export const precache = ${precacheJson === null ? 'null' : JSON.stringify(precacheJson)};

export const notFound = ${page('404.html')};
export const errorPage = ${page('500.html')};
`;
}

function walkAll(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkAll(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * Public files of a kind `src/mime.js` has no type for.
 *
 * The build says so rather than sending `application/octet-stream` quietly.
 * `nosniff` is on every response, so a browser is told it may not guess, and a
 * file typed like that is one it will refuse to use rather than one it renders
 * badly. Extensions rather than paths: forty tiles of one unknown kind are one
 * thing to fix.
 */
function untypedExtensions(dir) {
  const found = new Set();
  for (const file of walkAll(dir)) {
    if (file.endsWith('.br') || file.endsWith('.gz')) continue;
    if (known(file)) continue;
    found.add(path.extname(file) || path.basename(file));
  }
  return [...found].sort();
}

// ---- precache manifest ----------------------------------------------------
//
// Written before the asset module, so a runtime with no disk carries it too, and
// before compression, so it ships with a .br and a .gz like anything else.

let precacheJson = null;
if (config.precache) {
  const files = fs.existsSync(publicOut)
    ? walkAll(publicOut)
        .filter((file) => !file.endsWith('.br') && !file.endsWith('.gz'))
        .map((file) => [
          `/${path.relative(publicOut, file).split(path.sep).join('/')}`,
          { etag: etagOf(fs.readFileSync(file)) },
        ])
    : [];

  // Every entry read, so every one has an ETag. The default budget leaves a
  // large file on disk with no hash, and `precacheList` refuses that rather than
  // calling it immutable.
  const entries = precacheList({
    pages: loadStatic(path.join(dist, 'static'), { maxBytes: Infinity }).entries,
    assets: loadAssets(path.join(dist, 'client'), { maxBytes: Infinity }).entries,
    files,
  });

  precacheJson = precacheDocument(entries, etagOf(JSON.stringify(entries)).replaceAll('"', ''));
  write(PRECACHE_PATH.replace(/^\//, ''), precacheJson);
}

fs.writeFileSync(path.join(dist, 'server/assets.js'), assetModule());

// ---- compress -------------------------------------------------------------

// `precompress` only touches extensions it knows are worth compressing, so a
// public directory full of images costs nothing here.
const compressed = await precompress([
  path.join(dist, 'static'),
  path.join(dist, 'client'),
  publicOut,
]);

const summary = [
  `${prerendered.length} page${prerendered.length === 1 ? '' : 's'} prerendered`,
  `${CONCURRENCY} at a time`,
  `${dynamic.length} route${dynamic.length === 1 ? '' : 's'} left to the server`,
  `${assets.size} client entr${assets.size === 1 ? 'y' : 'ies'}`,
  ...(publicFiles ? [`${publicFiles} public file${publicFiles === 1 ? '' : 's'}`] : []),
  ...(iconCount
    ? [
        `${iconCount} icon${iconCount === 1 ? '' : 's'} in ` +
          `${libraryCount} sheet${libraryCount === 1 ? '' : 's'}`,
      ]
    : []),
];
console.log(`\n${summary.join(', ')}`);
for (const url of prerendered) console.log(`  ${url}`);
for (const route of dynamic) console.log(`  ${route.pattern}  (server-rendered)`);

// Last, and never silent. A draft is the one thing here that is absent from
// production on purpose, and the only way to tell a page that was skipped from
// a page that broke is to be told.
if (drafts.length) {
  console.log(
    `\n${drafts.length} draft${drafts.length === 1 ? '' : 's'} skipped, ` +
      `and served by \`npm run dev\`:`,
  );
  for (const route of drafts) console.log(`  ${route.pattern}`);
}

// Also never silent, and for the same reason a draft is not. A file sent as
// `application/octet-stream` under `nosniff` is a file the browser is forbidden
// to interpret, so an audio clip does not play badly: it does not play at all.
const untypedHere = fs.existsSync(publicOut) ? untypedExtensions(publicOut) : [];
if (untypedHere.length) {
  console.log(
    `\n${untypedHere.length} kind${untypedHere.length === 1 ? '' : 's'} of public file ` +
      `has no content type here, and goes out as application/octet-stream:`,
  );
  for (const ext of untypedHere) console.log(`  ${ext}`);
  console.log('  Every response carries nosniff, so a browser will not guess past that.');
}

if (compressed.files) {
  const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
  const pct = (n) => `${Math.round((1 - n / compressed.raw) * 100)}%`;
  console.log(
    `\n${compressed.files} files precompressed: ${kb(compressed.raw)} raw, ` +
      `${kb(compressed.gzip)} gzip (−${pct(compressed.gzip)}), ` +
      `${kb(compressed.brotli)} brotli (−${pct(compressed.brotli)})`,
  );
}
if (!dynamic.length) console.log('\ndist/static is self-contained. Any static host will serve it.');
