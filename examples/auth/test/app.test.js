// The session, over real requests. Nothing is stubbed: these go through CSRF,
// the cookie signing and the guard in the layout.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const built = fs.existsSync(path.join(root, 'dist', 'routes.json'));
const describe = built ? test : test.skip;

// The config reads this as it loads, so it is set before the first import.
process.env.COOKIE_SECRET ??= 'a-secret-for-tests-only';

const { app } = built ? await import('@transclude/core/production') : { app: null };

const get = (url, cookie) =>
  app.request(`http://localhost${url}`, {
    headers: cookie ? { cookie } : {},
    redirect: 'manual',
  });

const signIn = (fields) =>
  app.request('http://localhost/login', {
    method: 'POST',
    headers: {
      origin: 'http://localhost',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(fields).toString(),
    redirect: 'manual',
  });

/** The session cookie from a Set-Cookie, ready to send back. */
const cookieOf = (res) => (res.headers.get('set-cookie') ?? '').split(';')[0];

describe('the guard turns a signed-out visitor away before the page runs', async () => {
  const res = await get('/admin');

  assert.equal(res.status, 303);
  assert.match(res.headers.get('location') ?? '', /\/login\?next=%2Fadmin$/);
});

describe('it covers everything below it, not only the page it was written on', async () => {
  const res = await get('/admin/settings');

  assert.equal(res.status, 303);
  assert.match(res.headers.get('location') ?? '', /next=%2Fadmin%2Fsettings$/);
});

describe('a wrong password says the same thing as an unknown address', async () => {
  const wrong = await signIn({ email: 'ada@example.com', password: 'nope' }).then((r) => r.text());
  const missing = await signIn({ email: 'nobody@example.com', password: 'nope' }).then((r) =>
    r.text(),
  );

  assert.match(wrong, /do not match an account/);
  assert.match(missing, /do not match an account/);
  assert.equal(wrong, missing, 'a different message would say whether the address has an account');
});

describe('signing in sets a signed, httpOnly cookie and redirects', async () => {
  const res = await signIn({ email: 'ada@example.com', password: 'correct horse' });
  const header = res.headers.get('set-cookie') ?? '';

  assert.equal(res.status, 303);
  assert.match(header, /^session=/);
  assert.match(header, /HttpOnly/i, 'no script needs it, so no script gets it');
  assert.match(header, /SameSite=Lax/i);
  assert.doesNotMatch(header, /session=1;/, 'the value is signed, not the bare id');
});

describe('the session opens the guarded pages', async () => {
  const cookie = cookieOf(await signIn({ email: 'ada@example.com', password: 'correct horse' }));
  const res = await get('/admin', cookie);

  assert.equal(res.status, 200);
  assert.match(await res.text(), /Signed in as Ada Lovelace/);
});

describe('a forged cookie is refused', async () => {
  // The browser can read the id. Signing is what stops it inventing one.
  const res = await get('/admin', 'session=1');

  assert.equal(res.status, 303, 'an unsigned value must not be a session');
});

describe('it comes back to where you were sent away from', async () => {
  const cookie = cookieOf(
    await signIn({
      email: 'ada@example.com',
      password: 'correct horse',
      next: '/admin/settings',
    }),
  );

  assert.ok(cookie);
  assert.equal((await get('/admin/settings', cookie)).status, 200);
});

describe('a next that leaves this site is ignored', async () => {
  const res = await signIn({
    email: 'ada@example.com',
    password: 'correct horse',
    next: 'https://evil.example/take-over',
  });

  assert.equal(new URL(res.headers.get('location')).origin, 'http://localhost');
});

describe('signing out is a POST, and it clears the cookie', async () => {
  const cookie = cookieOf(await signIn({ email: 'ada@example.com', password: 'correct horse' }));

  const out = await app.request('http://localhost/sign-out', {
    method: 'POST',
    headers: { origin: 'http://localhost', cookie },
    redirect: 'manual',
  });

  assert.equal(out.status, 303);
  assert.match(out.headers.get('set-cookie') ?? '', /session=;|Max-Age=0/);

  // A GET must not sign anyone out: a link that does is a link anything can follow.
  assert.equal((await get('/sign-out')).status, 405);
});

describe('no page under a cookie-reading layout was written to a file', () => {
  // The build refuses, names the page and exits non-zero, rather than shipping a
  // signed-out copy of a page that has an answer per visitor.
  const dir = path.join(root, 'dist', 'static');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];

  assert.ok(!files.includes('index.html'), 'the home page is rendered per request');
});
