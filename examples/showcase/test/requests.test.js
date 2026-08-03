// The app answering real requests.
//
// `transclude/production` builds the same Hono app `npm start` serves, from
// `dist`. Asking it for a URL runs everything a browser would meet: the
// trailing-slash redirect, CSRF, the app's own middleware, cookies, the cache,
// and the route table. Nothing is stubbed, so a test that passes here is about
// the site rather than about a mock of it.
//
// It needs a build. These skip without one rather than fail, so `npm test` is
// still useful on a fresh clone.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const built = fs.existsSync(path.join(root, 'dist', 'routes.json'));
const describe = built ? test : test.skip;

// The server reads this from `.env` through a flag in the `start` script, and
// `node --test` passes no such flag. Set before the config is imported, which
// happens on the first import below.
process.env.COOKIE_SECRET ??= 'a-secret-for-tests-only';

const { app } = built ? await import('transclude/production') : { app: null };
const get = (url, init) => app.request(`http://localhost${url}`, { redirect: 'manual', ...init });

const form = (body) => ({
  method: 'POST',
  headers: { origin: 'http://localhost', 'content-type': 'application/x-www-form-urlencoded' },
  body,
});

describe('a page answers with its own markup', async () => {
  const res = await get('/notes');

  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(await res.text(), /<h1/);
});

describe('a region is the same path with the query on it', async () => {
  const whole = await (await get('/')).text();
  const region = await get('/?fragment=matches');

  assert.equal(region.status, 200);
  const markup = await region.text();
  assert.doesNotMatch(markup, /<!doctype/i, 'the whole document came back');
  assert.ok(whole.includes(markup.trim()), 'the region is not what the page renders');
});

describe('a region nobody declared is a 404, because someone typed it', async () => {
  assert.equal((await get('/?fragment=nope')).status, 404);
});

describe('a trailing slash is one redirect to the one URL', async () => {
  const res = await get('/notes/');

  assert.equal(res.status, 301);
  assert.equal(new URL(res.headers.get('location')).pathname, '/notes');
});

describe('a form post changes something and redirects', async () => {
  // 303, so the reload after it is a GET. Anything else leaves the browser on a
  // POST and every refresh submits the form again.
  const res = await get('/notes', form('text=from+a+test'));

  assert.equal(res.status, 303);
  assert.equal(new URL(res.headers.get('location')).pathname, '/notes');
});

describe('a post from another origin is refused', async () => {
  const res = await app.request('http://localhost/notes', {
    method: 'POST',
    headers: { origin: 'http://evil.test', 'content-type': 'application/x-www-form-urlencoded' },
    body: 'text=x',
  });

  assert.equal(res.status, 403);
});

describe('a URL no route answers is the 404 page, not a stack', async () => {
  const res = await get('/nothing-here');

  assert.equal(res.status, 404);
  assert.doesNotMatch(await res.text(), /at .*\.js:\d+/, 'a stack reached the body');
});
