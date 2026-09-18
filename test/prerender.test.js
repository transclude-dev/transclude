// What a page is allowed to be, if it is going to be a file.
//
// These six messages are the build's whole vocabulary for "this URL cannot be
// written down". Until this file they were checked by hand: `bin/build.js` runs
// a build the moment it is imported, so no test could reach them, and every one
// was verified by breaking an example on purpose and reading the output.

import test from 'node:test';
import assert from 'node:assert/strict';

import { preloadsOf, prerenderContext, refusePrerender } from '../src/prerender.js';

const contextFor = (over = {}) =>
  prerenderContext({ route: { id: 'notes', pattern: '/notes' }, url: '/notes', params: {}, ...over });

// ---- what the loader is handed --------------------------------------------

test('there is no request, which is what a layout branches on', () => {
  assert.equal(contextFor().request, null);
});

test('the url is absolute, because a loader may build one from it', () => {
  assert.equal(contextFor().url, 'http://localhost/notes');
});

test('a route with no pattern still gets one, since the shape is fixed', () => {
  // `notFound` and the error page arrive without one. An undefined `pattern`
  // would reach a loader that reads it and read as a missing route instead.
  const ctx = prerenderContext({ route: { id: '404' }, url: '/404', params: {} });
  assert.deepEqual(ctx.route, { id: '404', pattern: '', path: '/404' });
});

// ---- the two that refuse rather than being absent --------------------------

test('revalidateTag says there is nothing held yet to drop', () => {
  assert.throws(() => contextFor().revalidateTag('notes'), /holds no rendered pages to drop/);
});

test('after says a file has no response to outlive', () => {
  assert.throws(() => contextFor().after(Promise.resolve()), /no response for that work to outlive/);
});

test('both name the way out, because the message is the whole fix', () => {
  // Left off the object each was `undefined`, and the loader failed with
  // `x is not a function`. That named neither the page's mistake nor this.
  for (const call of [() => contextFor().revalidateTag('x'), () => contextFor().after(Promise.resolve())]) {
    assert.throws(call, /export const prerender = false/);
  }
});

// ---- what may be written ---------------------------------------------------

test('plain markup and an untouched response is a file', () => {
  assert.doesNotThrow(() => refusePrerender(contextFor(), '<p>notes</p>'));
});

test('a Response is the loader saying this is not a page', () => {
  const answer = new Response(null, { status: 302, headers: { Location: '/login' } });
  assert.throws(() => refusePrerender(contextFor(), answer), /answered with 302 instead of markup/);
});

test('a status a file cannot carry is refused', () => {
  const ctx = contextFor();
  ctx.response.status = 404;
  assert.throws(() => refusePrerender(ctx, '<p>gone</p>'), /answered 404, which no file can carry/);
});

test('a header a file cannot carry is refused, and it is named', () => {
  // Named because the fix depends on which one. A `Set-Cookie` is a different
  // mistake from a `Cache-Control`, and the build prints one line per page.
  const ctx = contextFor();
  ctx.response.headers.set('Cache-Control', 'no-store');
  assert.throws(() => refusePrerender(ctx, '<p>x</p>'), /set a cache-control header/i);
});

test('reading a cookie is refused even when nothing was written', () => {
  // The read is the test, not the write. A page that reads `theme` and renders
  // a class sets no header at all, and one file would hand the first visitor's
  // theme to everyone.
  const ctx = contextFor();
  ctx.cookies.get('theme');

  assert.throws(() => refusePrerender(ctx, '<p>x</p>'), /different for each visitor/);
});

test('writing a cookie without reading one is refused as a header', () => {
  // Two rules could catch this. The header one runs first, and its message is
  // the accurate one: nothing here was personal, the file just cannot carry it.
  const ctx = contextFor();
  ctx.cookies.set('seen', '1');

  assert.throws(() => refusePrerender(ctx, '<p>x</p>'), /no file can carry/);
});

// ---- the order they run in -------------------------------------------------

test('a Response is reported before anything the context says', () => {
  // A loader that redirected also often set a status and a header on the way.
  // Reporting those first would describe the symptom rather than the answer.
  const ctx = contextFor();
  ctx.response.status = 500;
  ctx.cookies.get('theme');

  assert.throws(() => refusePrerender(ctx, new Response(null, { status: 302 })), /instead of markup/);
});

// ---- what the entry is going to import ------------------------------------

const chunk = (fileName, over = {}) => ({ type: 'chunk', fileName, imports: [], ...over });

test('an entry names the chunks it imports, as URLs', () => {
  const preloads = preloadsOf([
    chunk('assets/index-a.js', { name: 'index', isEntry: true, imports: ['assets/runtime-r.js', 'assets/card-c.js'] }),
    chunk('assets/runtime-r.js'),
    chunk('assets/card-c.js', { imports: ['assets/runtime-r.js'] }),
  ]);

  assert.deepEqual(preloads.get('index'), ['/assets/runtime-r.js', '/assets/card-c.js']);
});

test('a chunk reached through another is named once, and the walk goes all the way down', () => {
  // The entry imports the card, and only the card imports the runtime. A browser
  // would find the runtime two round trips in.
  const preloads = preloadsOf([
    chunk('assets/index-a.js', { name: 'index', isEntry: true, imports: ['assets/card-c.js', 'assets/list-l.js'] }),
    chunk('assets/card-c.js', { imports: ['assets/runtime-r.js'] }),
    chunk('assets/list-l.js', { imports: ['assets/runtime-r.js'] }),
    chunk('assets/runtime-r.js'),
  ]);

  assert.deepEqual(preloads.get('index'), ['/assets/card-c.js', '/assets/list-l.js', '/assets/runtime-r.js']);
});

test('a dynamic import is not preloaded, because it is on demand by design', () => {
  const preloads = preloadsOf([
    chunk('assets/index-a.js', {
      name: 'index',
      isEntry: true,
      imports: ['assets/runtime-r.js'],
      dynamicImports: ['assets/tag-picker-t.js'],
    }),
    chunk('assets/runtime-r.js'),
    chunk('assets/tag-picker-t.js', { isDynamicEntry: true, imports: ['assets/runtime-r.js'] }),
  ]);

  assert.deepEqual(preloads.get('index'), ['/assets/runtime-r.js']);
  assert.equal(preloads.has('tag-picker'), false);
});

test('only an entry has a list, and an entry with no imports has an empty one', () => {
  const preloads = preloadsOf([
    { type: 'asset', fileName: 'assets/__global-g.css' },
    chunk('assets/docs-d.js', { name: 'docs', isEntry: true }),
    chunk('assets/runtime-r.js'),
  ]);

  assert.deepEqual([...preloads.keys()], ['docs']);
  assert.deepEqual(preloads.get('docs'), []);
});
