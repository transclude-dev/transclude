// The header a page uses to refuse a camera it was never going to open.
//
// Off by default on purpose, and the test for that is the important one here.
// A default-on policy would take the microphone from an app that wanted it, and
// the app would find out in a browser rather than in CI.

import test from 'node:test';
import assert from 'node:assert/strict';

import { PERMISSIONS_DEFAULTS, permissionsHeader } from '../src/permissions.js';
import { baseApp } from '../src/server.js';

test('off is off, in every spelling a config can reach it with', () => {
  assert.equal(permissionsHeader(false), null);
  assert.equal(permissionsHeader(null), null);
  assert.equal(permissionsHeader(undefined), null);
});

test('true is the default list, written as the header spells it', () => {
  const header = permissionsHeader(true);

  assert.equal(header?.name, 'Permissions-Policy');
  assert.match(header.value, /camera=\(\)/);
  assert.match(header.value, /geolocation=\(\)/);
  assert.match(header.value, /microphone=\(\)/);
  // One string, comma separated. A semicolon is the CSP grammar, not this one.
  assert.doesNotMatch(header.value, /;/);
});

test('an empty allowlist is nobody, and self is written bare', () => {
  const header = permissionsHeader({ features: { camera: [], fullscreen: ['self'] } });

  assert.equal(header?.value, 'camera=(), fullscreen=(self)');
});

test('features replace the list rather than adding to it', () => {
  // The whole point of writing one: an app that wants a camera says so, and
  // does not have to know which eleven names it is overriding.
  const header = permissionsHeader({ features: { camera: ['self'] } });

  assert.equal(header?.value, 'camera=(self)');
  assert.doesNotMatch(header.value, /geolocation/);
});

test('an empty features object sends no header at all', () => {
  assert.equal(permissionsHeader({ features: {} }), null);
});

test('the default list names no feature that already defaults to self', () => {
  // Restating the browser's own answer is noise, and getting one of these wrong
  // is expensive: `publickey-credentials-get=()` takes away a passkey login.
  const named = Object.keys(PERMISSIONS_DEFAULTS);

  assert.ok(!named.includes('fullscreen'));
  assert.ok(!named.includes('publickey-credentials-get'));
});

test('nothing is sent unless the app asked', async () => {
  const app = baseApp({ csrf: false });
  app.get('/x', (c) => c.text('hi'));

  const res = await app.request('http://x/x');
  assert.equal(res.headers.get('permissions-policy'), null);
});

test('an app that asked gets it on every response, including a 404', async () => {
  const app = baseApp({ csrf: false, permissionsPolicy: true });
  app.get('/x', (c) => c.text('hi'));

  const found = await app.request('http://x/x');
  assert.match(found.headers.get('permissions-policy') ?? '', /camera=\(\)/);

  // Before the router, the way `nosniff` is, so a static file and a miss both
  // carry it.
  const missing = await app.request('http://x/nothing');
  assert.match(missing.headers.get('permissions-policy') ?? '', /camera=\(\)/);
});
