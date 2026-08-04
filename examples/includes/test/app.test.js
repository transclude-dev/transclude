// Transclusion, over real requests. The external include is left out on
// purpose: it reads another host, and a test that needs the network is a test
// that fails for reasons about the network.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const built = fs.existsSync(path.join(root, 'dist', 'routes.json'));
const describe = built ? test : test.skip;

const { app } = built ? await import('@transclude/core/production') : { app: null };
const text = (url) => app.request(`http://localhost${url}`).then((res) => res.text());

const count = (haystack, needle) => haystack.split(needle).length - 1;

describe('a same-page include renders the content twice', async () => {
  const markup = await text('/');

  assert.equal(count(markup, 'Two pounds'), 2);
});

describe('the copy drops the id, and the original keeps it', async () => {
  const markup = await text('/');

  assert.equal(count(markup, 'id="pricing"'), 1, 'two elements answering to one name is invalid');
});

describe('a cross-route include renders the other page', async () => {
  const summary = await text('/summary');

  assert.match(summary, /A fragment is a resource\./);
  assert.match(summary, /An include is a call, not a fetch\./);
});

describe('a cross-route include keeps the id, and that is the difference', async () => {
  // A same-page include is always a second copy in one document, so the copy
  // gives up the name. A cross-route one brings content from a different
  // document, so there is one of it here and it keeps its name. Both pages hold
  // exactly one `id="list"`.
  assert.equal(count(await text('/summary'), 'id="list"'), 1);
  assert.equal(count(await text('/notes'), 'id="list"'), 1);
});

describe('the fragment still answers on its own URL', async () => {
  const alone = await text('/notes?fragment=list');

  assert.match(alone, /^<ul id="list"/);
  assert.doesNotMatch(alone, /<!doctype/i);
});

describe('no transclude tag survives into any page', async () => {
  for (const url of ['/', '/summary', '/elsewhere']) {
    assert.doesNotMatch(await text(url), /<transclude/, url);
  }
});

describe('the external include falls back rather than failing the page', async () => {
  // With no network it renders the children. That is what they are for.
  const markup = await text('/elsewhere');

  assert.equal((await app.request('http://localhost/elsewhere')).status, 200);
  assert.match(markup, /CC BY-SA 2\.5/, 'the credit is written by hand, not derived');
});
