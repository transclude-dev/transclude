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

test('no request at all, as when prerendering, reads nothing rather than throwing', () => {
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

test('the value is readable by the client, since signing is not encryption', async () => {
  const { response, cookies } = setup();
  await cookies.signed.set('mine', '3');
  assert.match(sent(response)[0], /^mine=3\./, 'the plain value is right there, plus a signature');
});

test('a tampered value reads as absent rather than as itself', async () => {
  // Untrusted input, so "no valid cookie" is the right answer, not a throw.
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
  // Appending to one throws rather than being ignored. Measured.
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

// ---- Secure follows the connection -----------------------------------------

const req = (url, headers = {}) => new Request(url, { headers });
const setOn = (request) => {
  const response = { headers: new Headers() };
  cookiesOf(request, response, 'secret').set('session', 'abc');
  return response.headers.get('set-cookie');
};

test('a cookie set over https says Secure', () => {
  assert.match(setOn(req('https://site.example/')), /Secure/);
});

test('a cookie set over http does not, so localhost still works in dev', () => {
  // Always on would break `http://localhost`, and an author who cannot keep a
  // session in dev turns the whole thing off, which is the worse outcome.
  assert.doesNotMatch(setOn(req('http://localhost:1960/')), /Secure/);
});

test('a proxy that terminates TLS is believed, because the lie fails closed', () => {
  // The request's own URL says http: for a visitor who used https:. Trusting the
  // header can only turn Secure on, and a cookie that is then withheld over
  // plain HTTP is the safe direction to be wrong in.
  const forwarded = req('http://site.example/', { 'x-forwarded-proto': 'https' });
  assert.match(setOn(forwarded), /Secure/);

  // A chain lists the original first.
  const chained = req('http://site.example/', { 'x-forwarded-proto': 'https, http' });
  assert.match(setOn(chained), /Secure/);
});

test('the header cannot turn Secure off', () => {
  const lying = req('https://site.example/', { 'x-forwarded-proto': 'http' });
  assert.match(setOn(lying), /Secure/);
});

test('an explicit value wins either way', () => {
  const response = { headers: new Headers() };
  cookiesOf(req('http://localhost/'), response, 's').set('a', '1', { secure: true });
  assert.match(response.headers.get('set-cookie'), /Secure/);
});

test('the other defaults are unchanged', () => {
  const header = setOn(req('https://site.example/'));

  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Lax/);
  assert.match(header, /Path=\//);
});

// ---- a secret that is set and empty ----------------------------------------
//
// From a real deploy. `wrangler secret put` took a blank line, so the binding
// existed and every `typeof` along the way said `string`. The old message told
// the reader to set a secret they were looking at, which sends you through the
// wiring rather than to the value.

test('an empty secret says so, rather than saying there is none', async () => {
  const response = { headers: new Headers() };
  const cookies = cookiesOf(new Request('http://x/'), response, '');

  await assert.rejects(() => cookies.signed.get('session'), /set to an empty string/);
});

test('a missing secret still says to set one', async () => {
  const response = { headers: new Headers() };
  const cookies = cookiesOf(new Request('http://x/'), response, null);

  await assert.rejects(() => cookies.signed.get('session'), /Set `cookieSecret` in/);
});

test('the two messages are not the same, which is the whole point', async () => {
  const empty = cookiesOf(new Request('http://x/'), { headers: new Headers() }, '');
  const missing = cookiesOf(new Request('http://x/'), { headers: new Headers() }, null);

  const of = async (cookies) => {
    try {
      await cookies.signed.get('session');
      return null;
    } catch (error) {
      return error.message;
    }
  };

  assert.notEqual(await of(empty), await of(missing));
});
