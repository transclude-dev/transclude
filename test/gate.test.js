// `export const gated` in `app/server.js`: the paths an app says are not public.
//
// The failure this exists for is silent and looks like success. Middleware does
// not run during a build, so a page behind a payment gate or an auth check is
// rendered, written to `dist/static`, counted in "3 pages prerendered", and then
// served by any static host to anyone who asks. Nothing errors.
//
// A layout guard is caught without this, and the difference is worth keeping in
// mind: the build runs layout loaders, and a guard reads a cookie, which the
// build already refuses to write down. Nothing runs `app/server.js` here at all.

import test from 'node:test';
import assert from 'node:assert/strict';

import { isGated, readGated } from '../src/gate.js';
import { sitemapEntries } from '../src/sitemap.js';

// ---- matching -------------------------------------------------------------

test('a path matches itself and nothing else', () => {
  assert.equal(isGated('/premium', ['/premium']), true);
  assert.equal(isGated('/premium/notes', ['/premium']), false);
  assert.equal(isGated('/premiums', ['/premium']), false);
  assert.equal(isGated('/', ['/premium']), false);
});

test('a trailing /* covers the path and everything under it', () => {
  assert.equal(isGated('/api', ['/api/*']), true);
  assert.equal(isGated('/api/weather', ['/api/*']), true);
  assert.equal(isGated('/api/weather/today', ['/api/*']), true);
  // The boundary is a segment, not a prefix. `/apiary` is a different route.
  assert.equal(isGated('/apiary', ['/api/*']), false);
});

test('an empty declaration gates nothing', () => {
  assert.equal(isGated('/premium', []), false);
  assert.equal(isGated('/premium'), false);
});

// ---- the declaration ------------------------------------------------------

test('nothing declared is an empty list, not a refusal', () => {
  assert.deepEqual(readGated(undefined), []);
  assert.deepEqual(readGated(null), []);
  assert.deepEqual(readGated([]), []);
});

test('a declaration that is not a list is refused', () => {
  // Every mistake here fails open: the build writes the file and reports it as
  // a page it prerendered. So each one is an error rather than a shrug.
  assert.throws(() => readGated('/premium'), /list of paths/);
  assert.throws(() => readGated({ '/premium': true }), /list of paths/);
});

test('an entry that is not a path is refused, and is named', () => {
  assert.throws(() => readGated(['premium']), /"premium"/);
  assert.throws(() => readGated(['/ok', 42]), /42/);
  assert.throws(() => readGated(['/ok', null]), /null/);
});

// ---- the sitemap ----------------------------------------------------------

const pageWith = (paths) => ({ notes: { paths } });

test('a gated route is not advertised', async () => {
  // Both halves of the failure. A crawler is told the URL exists, and whoever
  // follows it gets a 402 or a redirect, so the gate holds and the sitemap is
  // still wrong about what the site offers.
  const manifest = {
    routes: [
      { id: 'index', pattern: '/', params: [] },
      { id: 'premium', pattern: '/premium', params: [] },
    ],
    gated: ['/premium'],
  };

  const entries = await sitemapEntries(manifest, {});

  assert.deepEqual(entries.map((entry) => entry.path), ['/']);
});

test('a gated URL under an open pattern is left out on its own', async () => {
  const manifest = {
    routes: [{ id: 'notes', pattern: '/notes/:id', params: ['id'] }],
    gated: ['/notes/secret'],
  };

  const entries = await sitemapEntries(
    manifest,
    pageWith(() => [{ id: 'open' }, { id: 'secret' }]),
  );

  assert.deepEqual(entries.map((entry) => entry.path), ['/notes/open']);
});

test('an entry the app supplied itself is held to the same rule', async () => {
  // `entries` in the config is the app's own list, and an app that gates a path
  // and then lists it by hand meant the gate.
  const manifest = { routes: [], gated: ['/premium/*'] };

  const entries = await sitemapEntries(manifest, {}, {
    entries: [{ path: '/open' }, { path: '/premium/notes' }],
  });

  assert.deepEqual(entries.map((entry) => entry.path), ['/open']);
});

test('a manifest with no gated list behaves as it always did', async () => {
  const manifest = { routes: [{ id: 'index', pattern: '/', params: [] }] };

  const entries = await sitemapEntries(manifest, {});

  assert.deepEqual(entries.map((entry) => entry.path), ['/']);
});
