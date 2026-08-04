// The header half of the fragment story, over real requests.
//
// `fragmentHeader: 'HX-Target'` is what these check. It is documented in the
// config table and this is the only app that sets it.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const built = fs.existsSync(path.join(root, 'dist', 'routes.json'));
const describe = built ? test : test.skip;

const { app } = built ? await import('@transclude/core/production') : { app: null };

const get = (url, headers = {}) =>
  app.request(`http://localhost${url}`, { headers, redirect: 'manual' });

const post = (fields, headers = {}) =>
  app.request('http://localhost/', {
    method: 'POST',
    headers: {
      origin: 'http://localhost',
      'content-type': 'application/x-www-form-urlencoded',
      ...headers,
    },
    body: new URLSearchParams(fields).toString(),
    redirect: 'manual',
  });

describe('the header alone asks for a region, with no query parameter', async () => {
  const res = await get('/?q=ada', { 'HX-Target': 'people' });
  const markup = await res.text();

  assert.doesNotMatch(markup, /<!doctype/i);
  assert.match(markup, /^<ul id="people"/);
});

describe('without the header the same URL is a whole document', async () => {
  assert.match(await get('/?q=ada').then((r) => r.text()), /<!doctype/i);
});

describe('a header naming nothing is ignored, and the query is not', async () => {
  // htmx sends HX-Target on every request, including ones that want the whole
  // page, so a name it does not know cannot be an error. A query parameter was
  // typed by someone, so it is.
  assert.equal((await get('/', { 'HX-Target': 'nonsense' })).status, 200);
  assert.equal((await get('/?fragment=nonsense')).status, 404);
});

describe('naming a header adds it to Vary', async () => {
  const res = await get('/', { 'HX-Target': 'people' });

  assert.match(res.headers.get('vary') ?? '', /HX-Target/);
});

describe('an action answers a region with the region', async () => {
  const res = await post({ name: 'Barbara Liskov', role: 'Professor' }, { 'HX-Target': 'people' });

  assert.equal(res.status, 200, 'a redirect would swap a document into a list');
  assert.match(await res.text(), /^<ul id="people"/);
});

describe('the same action answers a plain form with a redirect', async () => {
  const res = await post({ name: 'Jean Bartik', role: 'Programmer' });

  assert.equal(res.status, 303, 'so a reload does not add them twice');
});

describe('htmx is served from this origin, which the policy requires', async () => {
  const res = await get('/htmx.min.js');
  assert.equal(res.status, 200);

  const page = await get('/').then((r) => r.text());
  assert.match(page, /<script src="\/htmx\.min\.js"/, 'the tag survives compiling');
  assert.match(page, /script-src 'self'/, 'which is why a CDN would not work here');
});
