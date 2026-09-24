// The URLs this site used to have, and what it tells a crawler about them now.
//
// A 404 is what a URL that never existed gets. These existed, and Search Console
// keeps a 404 on its list for months, so each one answers for itself: the issue
// moved, the form and its confirmation step are gone.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const built = fs.existsSync(path.join(root, 'dist', 'routes.json'));

// Reads what `npm run build` wrote, like the rest of the tests here.
const describe = built ? test : test.skip;

const { app } = built ? await import('@transclude/core/production') : { app: null };
const get = (url, host = 'transclude.dev') =>
  app.request(`https://${host}${url}`, { redirect: 'manual' });

describe('issue one of the newsletter moves to the post it became', async () => {
  const res = await get('/newsletter/001');

  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), '/blog/svg-already-does-transclusion');
});

describe('the signup form and its confirmation step are gone', async () => {
  for (const url of ['/subscribe', '/confirm']) {
    assert.equal((await get(url)).status, 410, `${url} is gone`);
  }
});

describe('a speculation pattern asked for as a URL is a 404', async () => {
  // Every page carries `{"href_matches":"/source/*"}` for the route the server
  // renders, and a crawler reads that JSON and asks for the pattern. `*` names
  // no file, so 404 is the answer, and it is the right one.
  assert.equal((await get('/source/*')).status, 404);
});

describe('www goes to the apex, and the path and query travel with it', async () => {
  const res = await get('/docs/fragments?a=1', 'www.transclude.dev');

  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), 'https://transclude.dev/docs/fragments?a=1');
});
