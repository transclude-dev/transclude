import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { scanRoutes, toRoute } from '../src/routes.js';

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
