// A layout that answers for itself stops what is below it, including an action.
//
// It did not. The action ran first and the layout chain was only walked by the
// render afterwards, so a signed-out POST reached the handler, changed whatever
// it changed, and then met the guard on its way back out. The reader got the
// redirect. A request stopped at the door gets that same redirect, so the
// response could not be told apart from a request that never ran, and neither
// could a log of it.
//
// `examples/auth` never caught it because its guarded pages are read-only. The
// docs described the behaviour this file now checks: "Return a Response from a
// layout loader and it stops there. Nothing below it runs."

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runGuards } from '../src/document.js';
import { createApp } from '../src/app.js';

const layoutOf = (over = {}) => ({
  load: async () => ({}),
  render: (_d, slots) => ({ default: slots.default ?? '' }),
  css: '',
  headScript: '',
  hasTitle: false,
  renderTitle: () => '',
  renderHead: () => '',
  elements: [],
  ...over,
});

const pageOf = (over = {}) => ({
  layouts: [],
  css: '',
  headScript: '',
  hasTitle: false,
  renderTitle: () => '',
  renderHead: () => '',
  elements: [],
  regions: {},
  load: async () => ({}),
  render: () => ({ default: '<p>page</p>' }),
  ...over,
});

const redirect = () => Response.redirect('http://x/login', 303);

// ---- runGuards -------------------------------------------------------------

test('a page with no layouts is let through', async () => {
  assert.equal(await runGuards(pageOf(), {}), null);
});

test('layouts that all return data let it through', async () => {
  const page = pageOf({ layouts: [layoutOf(), layoutOf()] });

  assert.equal(await runGuards(page, {}), null);
});

test('a layout answering with a Response is the answer', async () => {
  const page = pageOf({ layouts: [layoutOf({ load: redirect })] });
  const out = await runGuards(page, {});

  assert.ok(out instanceof Response);
  assert.equal(out.status, 303);
  assert.equal(out.headers.get('location'), 'http://x/login');
});

test('nothing below the one that answered runs', async () => {
  const ran = [];
  const page = pageOf({
    layouts: [
      layoutOf({ load: async () => { ran.push('outer'); return {}; } }),
      layoutOf({ load: async () => { ran.push('guard'); return redirect(); } }),
      layoutOf({ load: async () => { ran.push('inner'); return {}; } }),
    ],
  });

  await runGuards(page, {});

  assert.deepEqual(ran, ['outer', 'guard']);
});

test('a layout is handed what the ones above it returned', async () => {
  const seen = [];
  const page = pageOf({
    layouts: [
      layoutOf({ load: async () => ({ user: 'ada' }) }),
      layoutOf({ load: async (ctx) => { seen.push(ctx.layout); return {}; } }),
    ],
  });

  await runGuards(page, {});

  assert.deepEqual(seen, [{ user: 'ada' }]);
});

test('the page’s own loader is not one of the guards', async () => {
  // It runs after the action, with `ctx.action` set. Running it here would be a
  // second call with a different context, which is not what a loader expects.
  let ran = false;
  const page = pageOf({ load: async () => { ran = true; return {}; } });

  await runGuards(page, {});

  assert.equal(ran, false);
});

// ---- through the server ----------------------------------------------------

const appWith = (page) =>
  createApp({
    config: { csrf: false },
    manifest: {
      routes: [{ id: 'admin', pattern: '/admin', params: [], client: null }],
      dynamic: [],
      endpoints: [],
    },
    pages: { admin: page },
    statics: { get: () => null },
    assets: { get: () => null },
    hash: (body) => `"${body.length.toString(36)}"`,
    compress: null,
  });

test('a guarded POST does not reach the handler', async () => {
  // The bug, as a test. The status was already right; what was wrong was that
  // the handler had run, so asserting on the response could not see it.
  const changed = [];
  const page = pageOf({
    layouts: [layoutOf({ load: redirect })],
    POST: async () => { changed.push('everything'); return {}; },
  });

  const res = await appWith(page).request('http://x/admin', { method: 'POST' });

  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), 'http://x/login');
  assert.deepEqual(changed, []);
});

test('an unguarded POST still reaches the handler', async () => {
  const changed = [];
  const page = pageOf({
    layouts: [layoutOf()],
    POST: async () => { changed.push('everything'); return {}; },
  });

  const res = await appWith(page).request('http://x/admin', { method: 'POST' });

  assert.equal(res.status, 200);
  assert.deepEqual(changed, ['everything']);
});

test('every method a form can send is guarded, not only POST', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const changed = [];
    const page = pageOf({
      layouts: [layoutOf({ load: redirect })],
      [method]: async () => { changed.push(method); return {}; },
    });

    const res = await appWith(page).request('http://x/admin', { method });

    assert.equal(res.status, 303, `${method} was not stopped`);
    assert.deepEqual(changed, [], `${method} reached the handler`);
  }
});

test('a guard stops a method the page does not answer, rather than saying 405', async () => {
  // Which verbs a page answers is information from behind the guard.
  const res = await appWith(pageOf({ layouts: [layoutOf({ load: redirect })] })).request(
    'http://x/admin',
    { method: 'POST' },
  );

  assert.equal(res.status, 303);
});

test('a header the guard set on the way through survives', async () => {
  const page = pageOf({
    layouts: [
      layoutOf({
        load: async (ctx) => {
          ctx.response.headers.set('x-why', 'signed out');
          return redirect();
        },
      }),
    ],
    POST: async () => ({}),
  });

  const res = await appWith(page).request('http://x/admin', { method: 'POST' });

  assert.equal(res.headers.get('x-why'), 'signed out');
});

// ---- the two servers ------------------------------------------------------

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** A file with its comments removed, so prose about the order cannot satisfy it. */
const read = (rel) =>
  fs
    .readFileSync(path.join(root, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

test('both servers ask the layouts before they run the action', () => {
  // `bin/dev.js` starts a server when it is imported, so this is a text check,
  // like `context-shape.test.js`. What it catches is the drift that keeps
  // happening here: production fixed, dev not, and the hole only in the place
  // nobody points a browser at.
  for (const file of ['src/app.js', 'bin/dev.js']) {
    const source = read(file);
    const guards = source.indexOf('runGuards(page');
    const action = source.indexOf('runAction(page');

    assert.notEqual(guards, -1, `${file} never calls runGuards`);
    assert.notEqual(action, -1, `${file} never calls runAction`);
    assert.ok(guards < action, `${file} runs the action before the guards`);
  }
});
