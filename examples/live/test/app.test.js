// The stream, over real requests.
//
// Every test here aborts what it opened. A stream nobody closes keeps the
// process alive, and a test run that never exits is worse than one that fails.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const built = fs.existsSync(path.join(root, 'dist', 'routes.json'));
const describe = built ? test : test.skip;

const { app } = built ? await import('@transclude/core/production') : { app: null };

/**
 * How many connections the running app thinks it has, read the way the page
 * reads it. Importing the store here would be a second copy of the module: the
 * app runs the bundled one, and the two hold different Sets.
 */
const listening = async () =>
  Number((await text('/?fragment=feed')).match(/(\d+) windows? listening/)?.[1] ?? -1);

const text = (url) => app.request(`http://localhost${url}`).then((res) => res.text());

const post = (body) =>
  app.request('http://localhost/?fragment=feed', {
    method: 'POST',
    headers: {
      origin: 'http://localhost',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body).toString(),
    redirect: 'manual',
  });

/** Opens the stream and gives back a reader, plus the abort that closes it. */
async function open() {
  const stop = new AbortController();
  const res = await app.request('http://localhost/events', { signal: stop.signal });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  return {
    res,
    next: async () => decoder.decode((await reader.read()).value),
    close: () => {
      reader.cancel().catch(() => {});
      stop.abort();
    },
  };
}

describe('the endpoint answers with a stream that stays open', async () => {
  const stream = await open();

  assert.equal(stream.res.headers.get('content-type'), 'text/event-stream');
  assert.equal(stream.res.headers.get('cache-control'), 'no-store');

  // Something straight away, so a proxy cannot hold an empty response open.
  assert.match(await stream.next(), /^: connected/);
  stream.close();
});

describe('a change writes a line to everyone listening', async () => {
  const stream = await open();
  await stream.next();

  const line = stream.next();
  await post({ text: 'from a test' });

  assert.match(await line, /event: notes\ndata: changed/);
  stream.close();
});

describe('the line carries a nudge, not the markup', async () => {
  // The list already has a URL. Sending rendered HTML down the stream would be
  // a second way to render the same thing, and the two would drift.
  const stream = await open();
  await stream.next();

  const line = stream.next();
  await post({ text: 'not in the stream' });

  assert.doesNotMatch(await line, /<li|<ul/);
  stream.close();
});

describe('closing the connection removes the listener', async () => {
  const before = await listening();

  const stream = await open();
  await stream.next();
  assert.equal(await listening(), before + 1, 'the connection was counted');

  stream.close();
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(await listening(), before, 'a listener outliving its connection is a leak');
});

describe('the fragment answers on its own, and holds everything that changes', async () => {
  const markup = await text('/?fragment=feed');

  assert.match(markup, /^<ul id="feed"/);
  assert.doesNotMatch(markup, /<!doctype/i);
  assert.match(markup, /listening\./, 'the count is inside the swapped element');
});

describe('the form works with no script at all', async () => {
  const res = await app.request('http://localhost/', {
    method: 'POST',
    headers: {
      origin: 'http://localhost',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ text: 'no script here' }).toString(),
    redirect: 'manual',
  });

  assert.equal(res.status, 303, 'post, redirect, get');
  assert.match(await text('/'), /no script here/);
});
