import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveRoutesDir, scanRoutes, toRoute } from '../src/routes.js';

const route = (rel) => toRoute(rel.split('/').join(path.sep), rel);

function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-routes-'));
  for (const rel of files) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, '<p>x</p>');
  }
  return dir;
}

// ---- one file at a time ---------------------------------------------------

test('index collapses to the directory it sits in', () => {
  assert.equal(route('index.html').pattern, '/');
  assert.equal(route('blog/index.html').pattern, '/blog');
});

test('a plain file is a static segment', () => {
  assert.equal(route('about.html').pattern, '/about');
  assert.equal(route('docs/intro.html').pattern, '/docs/intro');
});

test('[param] becomes a named Hono param', () => {
  const r = route('blog/[slug].html');
  assert.equal(r.pattern, '/blog/:slug');
  assert.deepEqual(r.params, ['slug']);
  assert.equal(r.hasRest, false);
});

test('[...rest] becomes a named regex param, not a bare wildcard', () => {
  // Hono's `*` does not give you a name; `:path{.+}` does.
  const r = route('docs/[...path].html');
  assert.equal(r.pattern, '/docs/:path{.+}');
  assert.deepEqual(r.params, ['path']);
  assert.equal(r.hasRest, true);
});

test('several params in one path', () => {
  const r = route('[org]/[repo]/settings.html');
  assert.equal(r.pattern, '/:org/:repo/settings');
  assert.deepEqual(r.params, ['org', 'repo']);
});

test('ids are URL-safe, because they travel through /@id/', () => {
  assert.equal(route('index.html').id, 'index');
  assert.equal(route('blog/[slug].html').id, 'blog-_slug');
  assert.equal(route('docs/[...path].html').id, 'docs-_path_rest');
  assert.equal(route('blog/index.html').id, 'blog-index');

  for (const rel of ['index.html', 'blog/[slug].html', 'docs/[...path].html']) {
    const { id } = route(rel);
    assert.match(id, /^[A-Za-z0-9_-]+$/);
    // A dot would read as a file extension and the dev server would never
    // transform the module — the page would silently ship no client JS.
    assert.doesNotMatch(id, /\./);
  }
});

// ---- scanning a tree ------------------------------------------------------

test('routes are ordered static, then dynamic, then catch-all', () => {
  const dir = fixture([
    'docs/[...path].html',
    'docs/[page].html',
    'docs/intro.html',
    'index.html',
  ]);
  const { routes } = scanRoutes(dir);
  assert.deepEqual(
    routes.map((r) => r.pattern),
    ['/docs/intro', '/', '/docs/:page', '/docs/:path{.+}'],
  );
});

test('404.html is the not-found handler, not a route', () => {
  const { routes, notFound } = scanRoutes(fixture(['index.html', '404.html']));
  assert.deepEqual(routes.map((r) => r.pattern), ['/']);
  assert.equal(notFound.id, '404');
});

test('underscore-prefixed files and directories are not routes', () => {
  const { routes } = scanRoutes(
    fixture(['index.html', '_partial.html', '_lib/helper.html', 'blog/_draft.html']),
  );
  assert.deepEqual(routes.map((r) => r.pattern), ['/']);
});

test('nested directories are walked', () => {
  const { routes } = scanRoutes(fixture(['a/b/c/deep.html']));
  assert.deepEqual(routes.map((r) => r.pattern), ['/a/b/c/deep']);
});

test('two files claiming one URL is an error, not a silent winner', () => {
  assert.throws(() => scanRoutes(fixture(['blog.html', 'blog/index.html'])), /collide/);
});

test('two files claiming one module id is an error too', () => {
  assert.throws(() => scanRoutes(fixture(['blog/[slug].html', 'blog-_slug.html'])), /collide/);
});

test('a missing pages directory is empty, not a crash', () => {
  const { routes, notFound } = scanRoutes(path.join(os.tmpdir(), 'hf-does-not-exist'));
  assert.deepEqual(routes, []);
  assert.equal(notFound, null);
});

// ---- endpoints -------------------------------------------------------------
//
// A `.js` file in the pages tree is a route with no template. Same filename
// conventions, because it is the same route table.

test('a .js file is an endpoint, a .html file is a page', () => {
  const dir = fixture(['index.html', 'api/people.js', 'api/people/[id].js']);
  const { routes, endpoints } = scanRoutes(dir);

  assert.deepEqual(routes.map((r) => r.pattern), ['/']);
  assert.deepEqual(endpoints.map((r) => r.pattern), ['/api/people', '/api/people/:id']);
  assert.ok(endpoints.every((r) => r.kind === 'endpoint'));
  assert.ok(routes.every((r) => r.kind === 'page'));
});

test('an endpoint gets the same filename conventions as a page', () => {
  const dir = fixture(['api/index.js', 'api/[id].js', 'api/files/[...path].js']);
  const { endpoints } = scanRoutes(dir);
  assert.deepEqual(endpoints.map((r) => r.pattern), ['/api', '/api/:id', '/api/files/:path{.+}']);
});

test('a page and an endpoint cannot claim the same URL', () => {
  assert.throws(
    () => scanRoutes(fixture(['about.html', 'about.js'])),
    /collide/,
  );
});

test('an _ prefixed .js file is a helper, not an endpoint', () => {
  // Which is the only reason a `.js` next to your pages is still safe to keep.
  const { endpoints } = scanRoutes(fixture(['index.html', '_helpers.js']));
  assert.deepEqual(endpoints, []);
});

test('404.js is not the not-found handler — that is a page', () => {
  const { endpoints, notFound } = scanRoutes(fixture(['404.js']));
  assert.equal(notFound, null);
  assert.deepEqual(endpoints.map((r) => r.pattern), ['/404']);
});

// ---- the rename ------------------------------------------------------------

test('the routes directory resolves when it exists', () => {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-app-'));
  fs.mkdirSync(path.join(app, 'routes'));
  assert.equal(resolveRoutesDir(app, 'routes'), path.join(app, 'routes'));
});

test('the old name is a migration error, not an empty route table', () => {
  // Silence here means every URL 404s and nothing says why — which is a poor way
  // to find out a directory was renamed.
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-app-'));
  fs.mkdirSync(path.join(app, 'pages'));

  assert.throws(
    () => resolveRoutesDir(app, 'routes'),
    (error) => /pages\/ is now routes\//.test(error.message) && /routesDir/.test(error.message),
  );
});

test('a custom routesDir still reports the old directory if it is the one there', () => {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-app-'));
  fs.mkdirSync(path.join(app, 'pages'));
  assert.throws(() => resolveRoutesDir(app, 'urls'), /is now urls\//);
});

test('neither directory is not an error — an empty app is allowed', () => {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-app-'));
  assert.equal(resolveRoutesDir(app, 'routes'), path.join(app, 'routes'));
});

test('both present means the new one wins, with nothing thrown', () => {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-app-'));
  fs.mkdirSync(path.join(app, 'pages'));
  fs.mkdirSync(path.join(app, 'routes'));
  assert.equal(resolveRoutesDir(app, 'routes'), path.join(app, 'routes'));
});
