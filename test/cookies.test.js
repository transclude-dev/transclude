// Cookies, on the two things a loader already has: `ctx.request` to read and
// `ctx.response.headers` to write.

import test from 'node:test';
import assert from 'node:assert/strict';

import { cookiesOf } from '../src/cookies.js';
import { responseOf, withEnvelope } from '../src/document.js';

const SECRET = 'a-secret-for-tests';

const setup = ({ header = '', secret = SECRET } = {}) => {
  const response = responseOf();
  const request = new Request('http://x/', { headers: header ? { Cookie: header } : {} });
  return { response, cookies: cookiesOf(request, response, secret) };
};

const sent = (response) => response.headers.getSetCookie?.() ?? [];

// ---- reading ---------------------------------------------------------------

test('a cookie the request carried is readable', () => {
  const { cookies } = setup({ header: 'session=abc; theme=dark' });
  assert.equal(cookies.get('session'), 'abc');
  assert.equal(cookies.get('theme'), 'dark');
});

test('a cookie that is not there is undefined, not empty string', () => {
  const { cookies } = setup({ header: 'a=1' });
  assert.equal(cookies.get('nope'), undefined);
});

test('percent-encoded values come back decoded', () => {
  const { cookies } = setup({ header: 'greeting=hello%20there' });
  assert.equal(cookies.get('greeting'), 'hello there');
});

test('no request at all — prerendering — reads nothing rather than throwing', () => {
  const response = responseOf();
  const cookies = cookiesOf(null, response, SECRET);
  assert.equal(cookies.get('session'), undefined);
  assert.deepEqual(Object.keys(cookies.all()), []);
});

test('all() has a null prototype, so an attacker-named cookie collides with nothing', () => {
  const { cookies } = setup({ header: 'constructor=evil; a=1' });
  const all = cookies.all();
  assert.equal(Object.getPrototypeOf(all), null);
  assert.equal(all.constructor, 'evil', 'on a plain object this would be the Object constructor');
});

test('a forged signed cookie is undefined, not false', async () => {
  // Hono says `false` for present-but-invalid and omits the key when absent.
  // Collapsing them is what keeps `?? fallback` doing what it looks like.
  const { cookies } = setup({ header: 'mine=99.forged' });
  const value = await cookies.signed.get('mine');
  assert.equal(value, undefined);
  assert.equal(value ?? 'fallback', 'fallback', 'false would have slipped past ??');
});

// ---- writing ---------------------------------------------------------------

test('set writes a Set-Cookie with defaults worth having', () => {
  const { response, cookies } = setup();
  cookies.set('session', 'abc');

  const [header] = sent(response);
  assert.match(header, /^session=abc/);
  assert.match(header, /Path=\//, 'no Path scopes it to the current directory');
  assert.match(header, /HttpOnly/, 'without it a script can read a session id');
  assert.match(header, /SameSite=Lax/);
});

test('options override the defaults', () => {
  const { response, cookies } = setup();
  cookies.set('theme', 'dark', { httpOnly: false, path: '/settings', maxAge: 60 });

  const [header] = sent(response);
  assert.doesNotMatch(header, /HttpOnly/);
  assert.match(header, /Path=\/settings/);
  assert.match(header, /Max-Age=60/);
});

test('two cookies are two headers, not one overwritten', () => {
  // `Headers.set` would throw the first away; this has to append.
  const { response, cookies } = setup();
  cookies.set('a', '1');
  cookies.set('b', '2');

  assert.equal(sent(response).length, 2);
});

test('delete is an expiry in the past, because there is no delete verb', () => {
  const { response, cookies } = setup();
  cookies.delete('session');

  const [header] = sent(response);
  assert.match(header, /Max-Age=0/);
  assert.match(header, /Expires=Thu, 01 Jan 1970/);
});

// ---- signing --------------------------------------------------------------

test('a signed cookie round trips', async () => {
  const { response, cookies } = setup();
  await cookies.signed.set('mine', '3');

  const [header] = sent(response);
  const back = setup({ header: header.split(';')[0] });
  assert.equal(await back.cookies.signed.get('mine'), '3');
});

test('the value is readable by the client — signing is not encryption', async () => {
  const { response, cookies } = setup();
  await cookies.signed.set('mine', '3');
  assert.match(sent(response)[0], /^mine=3\./, 'the plain value is right there, plus a signature');
});

test('a tampered value reads as absent rather than as itself', async () => {
  // Untrusted input, so "no valid cookie" is the honest answer, not a throw.
  const { cookies } = setup({ header: 'mine=99.notarealsignature' });
  assert.equal(await cookies.signed.get('mine'), undefined);
});

test('a cookie signed with another secret does not verify', async () => {
  const { response } = setup();
  const other = cookiesOf(new Request('http://x/'), response, 'a-different-secret');
  await other.signed.set('mine', '3');

  const back = setup({ header: sent(response)[0].split(';')[0] });
  assert.equal(await back.cookies.signed.get('mine'), undefined);
});

test('signing without a secret is an error, not a silent downgrade', async () => {
  // A signature nobody can check is worse than no signature.
  const { cookies } = setup({ secret: null });
  await assert.rejects(() => cookies.signed.set('mine', '1'), /needs a secret/);
  await assert.rejects(() => cookies.signed.get('mine'), /needs a secret/);
});

test('unsigned cookies still work with no secret configured', () => {
  const { response, cookies } = setup({ secret: null });
  cookies.set('theme', 'dark');
  assert.equal(sent(response).length, 1);
});

// ---- surviving a short circuit --------------------------------------------

test('a cookie set before a redirect is still on the redirect', async () => {
  // The bug this exists for: an action sets a session cookie and returns a
  // redirect, the Response short-circuits the render, and nothing looked at the
  // envelope on that path.
  const ctx = { response: responseOf() };
  ctx.cookies = cookiesOf(new Request('http://x/'), ctx.response, SECRET);
  await ctx.cookies.signed.set('session', 'abc');

  const out = withEnvelope(new Response(null, { status: 303, headers: { Location: '/in' } }), ctx);
  assert.equal(out.status, 303);
  assert.equal(out.headers.get('location'), '/in');
  assert.match(out.headers.getSetCookie()[0], /^session=abc\./);
});

test('Response.redirect has immutable headers, so the copy is required', () => {
  // Appending to one throws rather than being ignored — measured.
  const redirect = Response.redirect('http://x/in', 303);
  assert.throws(() => redirect.headers.append('Set-Cookie', 'a=1'));

  const ctx = { response: responseOf() };
  ctx.response.headers.append('Set-Cookie', 'a=1');

  const out = withEnvelope(redirect, ctx);
  assert.equal(out.status, 303);
  assert.equal(out.headers.get('location'), 'http://x/in');
  assert.equal(out.headers.get('set-cookie'), 'a=1');
});

test('nothing collected means the response is passed through untouched', () => {
  const original = new Response('body', { status: 201 });
  assert.equal(withEnvelope(original, { response: responseOf() }), original);
  assert.equal(withEnvelope(original, null), original);
});

test('a status the envelope carries is not lost on a short circuit', () => {
  const ctx = { response: responseOf() };
  ctx.response.headers.set('X-Thing', '1');
  const out = withEnvelope(new Response('b', { status: 418 }), ctx);
  assert.equal(out.status, 418);
});
