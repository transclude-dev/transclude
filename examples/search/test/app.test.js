// The page and its fragment, asked for over real requests.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const built = fs.existsSync(path.join(root, 'dist', 'routes.json'));
const describe = built ? test : test.skip;

const { app } = built ? await import('@transclude/core/production') : { app: null };
const get = (url) => app.request(`http://localhost${url}`, { redirect: 'manual' });
const text = (url) => get(url).then((res) => res.text());

describe('a search with no script returns the whole document', async () => {
  const markup = await text('/?q=form');

  assert.match(markup, /<!doctype/i);
  assert.ok(markup.includes('<code>&lt;form&gt;</code>'));
});

describe('the same search as a fragment returns the fragment alone', async () => {
  const fragment = await text('/?q=form&fragment=results');

  assert.doesNotMatch(fragment, /<!doctype/i, 'no document, no head, no layout');
  assert.match(fragment, /^<div id="results"/);
});

describe('the fragment is exactly what the document already held', async () => {
  // The point of a fragment: one compiled template, so the two cannot drift.
  const whole = await text('/?q=form');
  const fragment = (await text('/?q=form&fragment=results')).trim();

  assert.ok(whole.includes(fragment));
});

describe('an empty query asks for nothing rather than everything', async () => {
  const fragment = await text('/?fragment=results');

  assert.match(fragment, /Type to search/);
  assert.doesNotMatch(fragment, /<li/);
});

describe('a query that matches nothing says so', async () => {
  const fragment = await text('/?q=zzzz&fragment=results');

  assert.match(fragment, /Nothing matched/);
});

describe('a fragment that does not exist is a 404', async () => {
  assert.equal((await get('/?fragment=nope')).status, 404);
});

describe('the page carries one script, and it is the enhancement', async () => {
  const markup = await text('/');
  const scripts = [...markup.matchAll(/<script[^>]*>/g)];

  assert.equal(scripts.length, 1, 'one entry, not one per feature');
  assert.match(markup, /src="\/assets\//, 'a built file rather than an inline block');
});
