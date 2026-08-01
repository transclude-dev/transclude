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
import { build } from 'vite';
import transclude from '../src/plugin.js';
import { loadProject } from '../src/project.js';
import { absoluteFrom, renderRoute, responseOf } from '../src/document.js';
import { feed, feedPath } from '../src/feed.js';
import { includeContext } from '../src/include.js';
import { nodeLookup } from '../src/lookup.js';
import { sitemap } from '../src/sitemap.js';
import { loadAssets, loadStatic } from '../src/static-cache.js';
import { cookiesOf } from '../src/cookies.js';
import { pool } from '../src/pool.js';
import { precompress } from '../src/compress.js';

const { root, config } = await loadProject();
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
    // `ssr: true` rather than a path: Vite resolves a string entry against the
    // project root before any plugin sees it, which a virtual id cannot survive.
    ssr: true,
    rollupOptions: {
      input: { entry: 'virtual:transclude-server' },
      output: { entryFileNames: '[name].js' },
    },
  },
});

// ---- prerender ------------------------------------------------------------

const { pages } = await import(pathToFileURL(path.join(dist, 'server/entry.js')).href);

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
async function urlsFor(route) {
  if (pages[route.id]?.prerender === false) return [];
  if (!route.params.length) return [{ url: route.pattern, params: {} }];

  const paths = pages[route.id]?.paths;
  if (typeof paths !== 'function') return [];

  const listed = (await paths()) ?? [];
  return listed.map((params) => ({
    url: route.pattern.replace(/:(\w+)(\{[^}]*\})?/g, (_, name) => String(params[name] ?? '')),
    params,
  }));
}

/**
 * A prerendered file has no status and no headers. It is a file. So a loader
 * that answered with a Response, or set a status other than 200, is saying this
 * URL is not a page you can write down, and the build says so rather than
 * writing a file that lies about it.
 */
async function render(route, { url, params }) {
  const response = responseOf();
  const ctx = {
    url: `http://localhost${url}`,
    params,
    route: { id: route.id, pattern: route.pattern ?? '', path: url },
    request: null,
    fragment: null,
    action: null,
    response,
    cookies: cookiesOf(null, response, config.cookieSecret),
    absolute: absoluteFrom(config.metadataBase, null),
  };

  const html = await renderRoute(pages[route.id], ctx, {
    clientEntry: assets.get(route.id) ?? null,
    stylesheet,
    csp: config.csp,
    include,
  });

  if (html instanceof Response) {
    throw new Error(`answered with ${html.status} instead of markup, so it cannot be prerendered`);
  }
  if (ctx.response.status !== 200) {
    throw new Error(`answered ${ctx.response.status}, which no file can carry`);
  }
  // A file carries no headers either. A Set-Cookie or a Cache-Control written here
  // would be thrown away, which is worse than being told.
  const [header] = [...ctx.response.headers.keys()];
  if (header) {
    throw new Error(`set a ${header} header, which no file can carry`);
  }
  // Reading a cookie is what makes a page personal, and there is no request
  // here to read one from. Whatever this file says about the reader is what a
  // reader with no cookies would have seen, and every visitor gets that copy.
  // A layout or an included route can do this without the page mentioning it,
  // which is what makes it worth saying out loud.
  if (ctx.cookies.personal) {
    throw new Error(
      `read a cookie, so it is different for each visitor and cannot be one file. ` +
        `Give it \`export const prerender = false\`, or stop reading the cookie ` +
        `here or in what it includes`,
    );
  }
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
  write('sitemap.xml', await sitemap({ routes: manifest.routes }, pages, config.sitemap));
  prerendered.push('/sitemap.xml');
}

if (config.feed) {
  const at = feedPath(config.feed);
  write(at.replace(/^\//, ''), await feed(config.feed));
  prerendered.push(at);
}

if (failures.length) {
  console.error(`\n${failures.length} page${failures.length === 1 ? '' : 's'} failed to render:`);
  for (const failure of failures) {
    console.error(`  ${failure.url}\n    ${failure.error.message}`);
  }
  process.exitCode = 1;
}

fs.writeFileSync(
  path.join(dist, 'routes.json'),
  JSON.stringify(
    {
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

if (publicSrc && fs.existsSync(publicSrc)) {
  fs.cpSync(publicSrc, publicOut, { recursive: true });
  publicFiles = countFiles(publicOut);
}

function countFiles(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    total += entry.isDirectory() ? countFiles(path.join(dir, entry.name)) : 1;
  }
  return total;
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
      publicMap.set(url, { body: fs.readFileSync(file), type: mimeOf(file) });
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

const MIMES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};
const mimeOf = (file) => MIMES[path.extname(file)] ?? 'application/octet-stream';

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
];
console.log(`\n${summary.join(', ')}`);
for (const url of prerendered) console.log(`  ${url}`);
for (const route of dynamic) console.log(`  ${route.pattern}  (server-rendered)`);

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
