import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderRoute } from '../src/document.js';

// framework/test -> framework -> project root
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dist = path.join(root, 'dist');
const built = fs.existsSync(path.join(dist, 'routes.json'));

// These assert on the output of `npm run build`, which is not run for us.
const describe = built ? test : test.skip;

const read = (rel) => fs.readFileSync(path.join(dist, rel), 'utf8');
const manifest = () => JSON.parse(read('routes.json'));

/**
 * A page left to the server has no file to read, so the assertions about its
 * output render it the way the server does — same bundle, same entry point.
 * Nothing about the compiler's output differs between the two paths; what
 * differs is that this one can see the request.
 */
const pages = built
  ? (await import(pathToFileURL(path.join(dist, 'server/entry.js')).href)).pages
  : {};

const serverRender = (id, url) => {
  const { dynamic, stylesheet } = manifest();
  const route = dynamic.find((entry) => entry.id === id);
  // Prerendered instead: the assertions about compiler output hold either way,
  // so they should keep working and let the opt-out test be the one that fails.
  if (!route) return read(id === 'index' ? 'static/index.html' : `static/${id}/index.html`);

  return renderRoute(
    pages[id],
    {
      url: `http://localhost${url}`,
      params: {},
      route: { id, pattern: route.pattern, path: url },
      req: null,
    },
    { clientEntry: route.client, stylesheet },
  );
};

const home = built ? await serverRender('index', '/') : '';

describe('static routes are prerendered to files a plain host can serve', () => {
  assert.ok(fs.existsSync(path.join(dist, 'static/check/index.html')));
  assert.ok(fs.existsSync(path.join(dist, 'static/404.html')));
});

describe('a dynamic route is prerendered once per entry its paths export names', () => {
  for (const slug of ['ada-lovelace', 'grace-hopper', 'radia-perlman']) {
    assert.ok(
      fs.existsSync(path.join(dist, `static/people/${slug}/index.html`)),
      `missing ${slug}`,
    );
  }
});

describe('a route with no paths export is left to the server', () => {
  const { dynamic } = manifest();
  assert.ok(dynamic.map((route) => route.pattern).includes('/docs/:path{.+}'));
});

describe('rendered HTML carries both renderings', () => {
  const html = home;

  // Elements that opted into a shadow root ship one, inline.
  assert.match(html, /<template shadowrootmode="open">/);
  assert.ok(html.split('shadowrootmode').length - 1 >= 2, 'nested roots survived');

  // Light ones are just markup, with their styles hoisted and scoped.
  assert.match(html, /@scope \(/);
  assert.match(html, /<data-table[^>]*>\s*<table/, 'a light element renders inline');
});

describe('layout chrome and layout data are baked in', () => {
  const detail = read('static/people/ada-lovelace/index.html');
  assert.match(detail, /<nav>/, 'root layout');
  assert.match(detail, /class="crumbs"/, 'nested layout');
  assert.match(detail, /Entry 1 of 3/, 'data that came from the layout above');
});

describe('the page title beats the layout title in built output', () => {
  assert.match(home, /<title>Single-file components — html-first spike<\/title>/);
  assert.match(read('static/404.html'), /<title>Not found<\/title>/);
});

describe('escaping survives the build', () => {
  const html = home;
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
});

describe('client entries are hashed, and only emitted where needed', () => {
  assert.match(home, /<script type="module" src="\/assets\/[^"]+-[A-Za-z0-9_-]{8}\.js">/);

  // /docs ships no components and no client script.
  const docs = manifest().dynamic.find((route) => route.id.startsWith('docs'));
  assert.equal(docs.client, null);
});

describe('the site stylesheet is one hashed, cacheable file', () => {
  const html = home;
  const links = html.match(/<link[^>]+stylesheet[^>]*>/g) ?? [];

  assert.equal(links.length, 1, 'exactly one — it is shared by every page');
  assert.match(links[0], /href="\/assets\/[^"]+-[A-Za-z0-9_-]{8}\.css"/);

  // Everything the compiler produces still travels inline: no second request.
  assert.match(html, /<style>/);
});

describe('every page links the same stylesheet', () => {
  const hrefOf = (html) => /<link[^>]+href="([^"]+\.css)"/.exec(html)?.[1];
  const href = (file) => hrefOf(read(file));
  assert.equal(hrefOf(home), href('static/people/ada-lovelace/index.html'));
  assert.equal(hrefOf(home), href('static/404.html'));
});

describe('no dev-server plumbing leaks into built output', () => {
  const html = home;
  assert.doesNotMatch(html, /@vite\/client/);
  assert.doesNotMatch(html, /__x00__/);
  assert.doesNotMatch(html, /virtual:hf-/);
});

describe('the server bundle runs without vite', () => {
  const entry = read('server/entry.js');
  // Virtual ids may survive in rollup's region comments; what matters is that
  // nothing still tries to *import* one, since nothing would resolve it.
  assert.doesNotMatch(entry, /from\s*['"]virtual:hf-/, 'a virtual id is still imported');
  assert.doesNotMatch(entry, /from\s*['"]vite/, 'vite is still imported');
  assert.match(entry, /export\s*\{[^}]*pages/, 'exports the page map');
});

describe('a page opting out of prerendering is left to the server', () => {
  const patterns = manifest().dynamic.map((route) => route.pattern);

  // index.html exports `prerender = false` because it reads ?q, and one
  // prerendered file is one file for every URL that resolves to it.
  assert.ok(patterns.includes('/'), 'a static route with prerender=false must reach the server');
  assert.ok(!fs.existsSync(path.join(dist, 'static/index.html')), 'it was prerendered anyway');

  // The opt-out is per page, not a switch on the whole build.
  assert.ok(fs.existsSync(path.join(dist, 'static/check/index.html')), 'other pages still prerender');
});

describe('a server-rendered page can see the query string', async () => {
  assert.match(await serverRender('index', '/?q=hello'), /Searching for <code>hello<\/code>/);
  assert.doesNotMatch(home, /Searching for/, 'no query, no line');

  // The reason it has to be server-rendered at all: one file cannot do this.
  const other = await serverRender('index', '/?q=world');
  assert.match(other, /Searching for <code>world<\/code>/);
});

describe('a query value is escaped like any other interpolation', async () => {
  const html = await serverRender('index', '/?q=%3Cscript%3Ealert(1)%3C/script%3E');
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<code><script>/);
});
