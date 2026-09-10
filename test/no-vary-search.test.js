// A `No-Vary-Search` that hides `?fragment=` is the one shape of that header
// this framework cannot survive. `/notes` and `/notes?fragment=list` have
// different bodies at the same path, so a cache told to treat them as one URL
// answers the fragment with the document, and the swap writes the whole page
// into the element. Nothing reports it: both responses are a 200 with markup.

import test from 'node:test';
import assert from 'node:assert/strict';

import { hidesParam, refuseHiddenFragment } from '../src/no-vary-search.js';
import { baseApp } from '../src/server.js';

// ---- reading the header ----------------------------------------------------

test('nothing to read hides nothing', () => {
  assert.equal(hidesParam(null, 'fragment'), false);
  assert.equal(hidesParam(undefined, 'fragment'), false);
  assert.equal(hidesParam('', 'fragment'), false);
  assert.equal(hidesParam('   ', 'fragment'), false);
});

test('a blocklist hides only what it names', () => {
  assert.equal(hidesParam('params=("utm_source" "gclid")', 'fragment'), false);
  assert.equal(hidesParam('params=("utm_source" "fragment")', 'fragment'), true);
});

test('an allowlist hides everything it does not name', () => {
  // The trap. `except=()` is the shortest thing to write and the widest thing
  // to mean, and the article that teaches this header teaches it second.
  assert.equal(hidesParam('except=()', 'fragment'), true);
  assert.equal(hidesParam('except=("color" "size")', 'fragment'), true);
  assert.equal(hidesParam('except=("fragment")', 'fragment'), false);
  assert.equal(hidesParam('except=("fragment" "color")', 'fragment'), false);
});

test('an empty blocklist and an empty allowlist are opposites', () => {
  // `params=()` ignores nothing. `except=()` allows nothing to matter. One
  // character apart in meaning and nothing alike.
  assert.equal(hidesParam('params=()', 'fragment'), false);
  assert.equal(hidesParam('except=()', 'fragment'), true);
});

test('params on its own means every parameter', () => {
  assert.equal(hidesParam('params', 'fragment'), true);
  assert.equal(hidesParam('params=?1', 'fragment'), true);
});

test('key-order reorders and hides nothing', () => {
  assert.equal(hidesParam('key-order', 'fragment'), false);
  assert.equal(hidesParam('key-order, params=("utm_source")', 'fragment'), false);
  assert.equal(hidesParam('key-order, except=()', 'fragment'), true);
});

test('a shape this cannot read counts as hiding', () => {
  // Wrong this way is an error naming the author's own header. Wrong the other
  // way is a broken swap and no message at all.
  assert.equal(hidesParam('except=weird', 'fragment'), true);
  assert.equal(hidesParam('params=', 'fragment'), true);
});

test('the parameter asked about is the configured one', () => {
  // `fragmentParam` is a config key, so `part` or `piece` is as real as
  // `fragment` and the check cannot hard-code one.
  assert.equal(hidesParam('except=("fragment")', 'part'), true);
  assert.equal(hidesParam('except=("part")', 'part'), false);
});

// ---- the refusal -----------------------------------------------------------

test('the refusal names the parameter, the failure and the fix', () => {
  assert.throws(
    () => refuseHiddenFragment('except=()', 'fragment'),
    (error) => {
      assert.match(error.message, /hides `\?fragment=`/);
      assert.match(error.message, /whole document/);
      assert.match(error.message, /except=\("fragment"\)/);
      // The value, because an author with middleware and a loader both writing
      // headers needs to know which one this was.
      assert.match(error.message, /except=\(\)/);
      return true;
    },
  );
});

test('a header that hides nothing passes, and so does no header', () => {
  assert.doesNotThrow(() => refuseHiddenFragment('params=("utm_source")', 'fragment'));
  assert.doesNotThrow(() => refuseHiddenFragment(null, 'fragment'));
});

test('an app with no fragment parameter has nothing to protect', () => {
  // `fragmentParam: null` turns fragments off, and then `except=()` is a fair
  // thing to write.
  assert.doesNotThrow(() => refuseHiddenFragment('except=()', null));
  assert.doesNotThrow(() => refuseHiddenFragment('except=()', undefined));
});

// ---- through the server ----------------------------------------------------

test('a middleware that sets it site-wide is refused', async () => {
  // The realistic way in. Nothing in a page mentions the header, so a
  // compile-time check could never see this one.
  const app = baseApp({
    csrf: false,
    fragmentParam: 'fragment',
    middleware: (hono) => {
      hono.use('*', async (c, next) => {
        await next();
        c.header('No-Vary-Search', 'except=()');
      });
    },
  });
  app.get('/notes', (c) => c.html('<ul></ul>'));

  const res = await app.request('http://x/notes');
  assert.equal(res.status, 500);
});

test('a route that sets a safe one is served', async () => {
  const app = baseApp({ csrf: false, fragmentParam: 'fragment' });
  app.get('/notes', (c) => {
    c.header('No-Vary-Search', 'params=("utm_source")');
    return c.html('<ul></ul>');
  });

  const res = await app.request('http://x/notes');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('no-vary-search'), 'params=("utm_source")');
});

test('an app that configured no parameter is left alone', async () => {
  const app = baseApp({ csrf: false });
  app.get('/notes', (c) => {
    c.header('No-Vary-Search', 'except=()');
    return c.html('<ul></ul>');
  });

  const res = await app.request('http://x/notes');
  assert.equal(res.status, 200);
});

test('both servers pass the parameter, or one of them checks nothing', async () => {
  // `csp` is deliberately absent from the dev server's `baseApp` call and this
  // is not: the guard reads a header rather than writing one, so a value that
  // would break production has to break dev first.
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

  for (const file of ['src/app.js', 'bin/dev.js']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(source, /fragmentParam: config\.fragmentParam/, `${file} does not pass it`);
  }
});
