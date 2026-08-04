// The app answering real requests.
//
// `@transclude/core/production` builds the same app `npm start` serves, from
// `dist`. Asking it for a URL runs everything a browser would meet: CSRF, the
// trailing-slash redirect, the route table and the action. Nothing is stubbed.
//
// It needs a build, and skips without one rather than failing.

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

/**
 * A form submission, the way the browser sends one. The origin matters: CSRF
 * refuses a form-encoded post without it.
 */
const post = (url, fields) =>
  app.request(`http://localhost${url}`, {
    method: 'POST',
    headers: {
      origin: 'http://localhost',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(fields).toString(),
    redirect: 'manual',
  });

/** The visible text of every todo, in order. */
const labels = (markup) =>
  [...markup.matchAll(/<a class="label"[^>]*>([^<]*)</g)].map(([, text]) => text.trim());

describe('the page lists what the store holds', async () => {
  const markup = await get('/').then((res) => res.text());

  assert.deepEqual(labels(markup), ['Taste JavaScript', 'Buy a unicorn']);
});

describe('adding one redirects, and the next render shows it', async () => {
  const added = await post('/', { intent: 'add', text: 'Write it down' });
  assert.equal(added.status, 303, 'post, redirect, get');

  const markup = await get('/').then((res) => res.text());
  assert.ok(labels(markup).includes('Write it down'));

  await post('/', { intent: 'remove', id: idOf(markup, 'Write it down') });
});

describe('a filter is kept across the redirect', async () => {
  const res = await post('/?show=active', { intent: 'toggle', id: 2 });

  assert.equal(new URL(res.headers.get('location')).search, '?show=active');
  await post('/?show=active', { intent: 'toggle', id: 2 });
});

describe('active and completed show different rows', async () => {
  const all = await get('/').then((res) => res.text());
  const active = await get('/?show=active').then((res) => res.text());
  const completed = await get('/?show=completed').then((res) => res.text());

  assert.equal(labels(all).length, labels(active).length + labels(completed).length);
  assert.ok(labels(active).length > 0, 'something is unfinished to begin with');
});

describe('an unknown filter falls back to all rather than showing nothing', async () => {
  const markup = await get('/?show=nonsense').then((res) => res.text());

  assert.deepEqual(labels(markup), labels(await get('/').then((res) => res.text())));
});

describe('editing a row renders a field instead of a label', async () => {
  const markup = await get('/?editing=2').then((res) => res.text());

  assert.match(markup, /class="edit"/);
  assert.equal(labels(markup).length, 1, 'the row being edited has no label');
});

describe('renaming to nothing deletes the todo', async () => {
  await post('/', { intent: 'add', text: 'Briefly here' });
  const id = idOf(await get('/').then((res) => res.text()), 'Briefly here');

  await post('/', { intent: 'rename', id, text: '   ' });
  assert.ok(!labels(await get('/').then((res) => res.text())).includes('Briefly here'));
});

describe('the page ships no JavaScript', async () => {
  const markup = await get('/').then((res) => res.text());

  assert.doesNotMatch(markup, /<script/, 'a form-only app has nothing to send');
});

describe('a bad method is refused with the verbs that work', async () => {
  // The origin is what gets this as far as the router. Without one, CSRF
  // answers 403 first: a request with no content type counts as a form.
  const res = await app.request('http://localhost/', {
    method: 'PUT',
    headers: { origin: 'http://localhost' },
  });

  assert.equal(res.status, 405);
  assert.match(res.headers.get('allow') ?? '', /POST/);
});

/** The id of the row whose label is `text`. */
function idOf(markup, text) {
  const row = markup.split('<li').find((chunk) => chunk.includes(`>${text}<`));
  return Number(row?.match(/name="id" value="(\d+)"/)?.[1] ?? 0);
}
