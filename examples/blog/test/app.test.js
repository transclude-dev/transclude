// The built site, asked for over real requests. Every page here is a file, so
// most of this is checking that the build wrote what the routes describe.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const built = fs.existsSync(path.join(root, 'dist', 'routes.json'));
const describe = built ? test : test.skip;

const { app } = built ? await import('@transclude/core/production') : { app: null };
const get = (url) => app.request(`http://localhost${url}`, { redirect: 'manual' });
const text = (url) => get(url).then((res) => res.text());

describe('every post named by paths() was written to a file', () => {
  for (const slug of ['a-page-is-a-file', 'written-once', 'two-files-for-machines']) {
    assert.ok(
      fs.existsSync(path.join(root, 'dist', 'static', 'posts', slug, 'index.html')),
      `${slug} is a file`,
    );
  }
});

describe('a post renders its body as markup', async () => {
  const markup = await text('/posts/written-once');

  assert.match(markup, /<h1>Written once, served as bytes<\/h1>/);
  assert.match(markup, /<code>dist\/<\/code>/, 'html() rendered it rather than escaping it');
});

describe('a slug that is not a post is 404 and not a file', async () => {
  assert.equal((await get('/posts/nope')).status, 404);
  assert.ok(!fs.existsSync(path.join(root, 'dist', 'static', 'posts', 'nope')));
});

describe('the canonical URL is the page, not the origin', async () => {
  const markup = await text('/posts/written-once');

  assert.match(markup, /rel="canonical" href="https:\/\/blog\.example\/posts\/written-once"/);
});

describe('the sitemap lists every page, posts included', async () => {
  const xml = await text('/sitemap.xml');
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, url]) => url);

  assert.ok(locs.includes('https://blog.example/'));
  assert.ok(locs.includes('https://blog.example/about'));
  assert.ok(locs.includes('https://blog.example/posts/written-once'));
});

describe('the feed carries the posts, newest first', async () => {
  const xml = await text('/feed.xml');
  const titles = [...xml.matchAll(/<title>([^<]+)<\/title>/g)].map(([, t]) => t);

  // The first is the feed's own title, then the items.
  assert.deepEqual(titles.slice(1), [
    'Two files for machines',
    'Written once, served as bytes',
    'A page is a file',
  ]);
});

describe('the site ships no JavaScript', async () => {
  assert.doesNotMatch(await text('/'), /<script/);
  assert.doesNotMatch(await text('/posts/written-once'), /<script/);
});

describe('the build writes a precache manifest', async () => {
  // A list of what this build produced, for a service worker to cache. Nothing
  // in this app reads it; the point is that the shape is right and stays right.
  const manifest = JSON.parse(await text('/precache.json'));

  assert.ok(manifest.version, 'a version to name a cache after');
  assert.ok(manifest.precache.length >= 5, 'the pages, the stylesheet and the feeds');

  const bySlug = Object.fromEntries(manifest.precache.map((e) => [e.url, e.revision]));

  // A page keeps its URL and changes its bytes, so it carries an ETag.
  assert.match(bySlug['/posts/written-once'] ?? '', /^"/);

  // A hashed asset's name is its version, so it carries none. Backwards here is
  // how a service worker holds last week's page and cannot be talked out of it.
  const hashed = manifest.precache.filter((e) => e.url.startsWith('/assets/'));
  assert.ok(hashed.length > 0);
  for (const entry of hashed) assert.equal(entry.revision, null);

  // Sorted, so two builds of the same site produce the same file.
  const urls = manifest.precache.map((e) => e.url);
  assert.deepEqual(urls, [...urls].sort());
});
