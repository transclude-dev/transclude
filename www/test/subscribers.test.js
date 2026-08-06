// The subscriber list, on the path Node takes.
//
// These run against the in-memory fallback, which is what `npm run dev` and CI
// use. The D1 branch is the same shape with SQL in it, and the two are checked
// against each other by hand on a deploy. What is worth testing here is the
// rules: what an upsert does to a confirmed address, what a token is worth once
// it is used, and what happens to a second signup.

import test from 'node:test';
import assert from 'node:assert/strict';

import { add, confirm, looksLikeEmail, newToken } from '../app/lib/subscribers.js';

const unique = (name) => `${name}-${newToken().slice(0, 8)}@example.com`;

// ---- what counts as an address ---------------------------------------------

test('an ordinary address passes', () => {
  assert.equal(looksLikeEmail('joe@example.com'), true);
  assert.equal(looksLikeEmail('joe+notes@example.co.uk'), true);
});

test('what is missing an at, a dot or a body is refused', () => {
  for (const bad of ['joe', 'joe@example', '@example.com', 'joe@.com', '', 'a b@c.com']) {
    assert.equal(looksLikeEmail(bad), false, `${JSON.stringify(bad)} should not pass`);
  }
});

// ---- tokens ----------------------------------------------------------------

test('a token is long, and no two are the same', () => {
  const seen = new Set(Array.from({ length: 200 }, () => newToken()));

  assert.equal(seen.size, 200);
  assert.ok([...seen][0].length >= 40, 'a short token is a guessable one');
});

test('a token is URL safe, because it travels in a query string', () => {
  for (let i = 0; i < 50; i += 1) assert.match(newToken(), /^[A-Za-z0-9_-]+$/);
});

// ---- signing up ------------------------------------------------------------

test('a signup is pending, and hands back a token', async () => {
  const { token, already } = await add(unique('new'), '/');

  assert.equal(already, false);
  assert.match(token, /^[A-Za-z0-9_-]+$/);
});

test('signing up twice replaces the token, because the first mail went astray', async () => {
  const email = unique('twice');
  const first = await add(email, '/');
  const second = await add(email, '/');

  assert.notEqual(second.token, first.token);
  assert.equal(second.already, false);
});

test('the replaced token stops working', async () => {
  // Otherwise a link from an old mail confirms an address whose newer link is
  // still out there, and two links are live at once.
  const email = unique('replaced');
  const first = await add(email, '/');
  await add(email, '/');

  assert.equal(await confirm(first.token), null);
});

// ---- confirming ------------------------------------------------------------

test('a token confirms the address it was issued for', async () => {
  const email = unique('confirm');
  const { token } = await add(email, '/');

  assert.equal(await confirm(token), email);
});

test('a token is spent once', async () => {
  // The confirm route is a GET, so a prefetcher, a scanner or a second click
  // will follow it again. The second one must not look like a fresh signup.
  const { token } = await add(unique('once'), '/');

  assert.notEqual(await confirm(token), null);
  assert.equal(await confirm(token), null);
});

test('a token nobody issued confirms nothing', async () => {
  assert.equal(await confirm('not-a-real-token'), null);
  assert.equal(await confirm(''), null);
});

test('a confirmed address is left alone by a later signup', async () => {
  // The one that matters. Moving a confirmed subscriber back to pending would
  // quietly stop their mail until they noticed and signed up again.
  const email = unique('settled');
  const { token } = await add(email, '/');
  await confirm(token);

  const again = await add(email, '/blog');
  assert.equal(again.already, true);

  // And the address is still confirmed rather than pending again.
  assert.equal(await confirm(again.token), null);
});
