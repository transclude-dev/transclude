// What a config means when it does not say, and where that gets applied.
//
// Written after `?fragment=` returned whole documents on every deployed worker.
// `loadProject` filled these in, and only Node has one. A worker imports the
// config module and hands `createApp` exactly what the author wrote, so any key
// they left out was undefined. `fragmentParam` undefined reads as "no parameter
// configured", so the fragment check never matched and the swap wrote a second
// copy of the page into the element it should have replaced.

import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULTS, withDefaults } from '../src/defaults.js';
import { createApp } from '../src/app.js';

// ---- the merge -------------------------------------------------------------

test('an absent key takes the default', () => {
  assert.equal(withDefaults({}).fragmentParam, 'fragment');
  assert.equal(withDefaults({}).trailingSlash, 'never');
  assert.equal(withDefaults({}).lang, 'en');
});

test('a key the author wrote wins, including a falsy one', () => {
  // `fragmentParam: null` is how the parameter is turned off. Merging the other
  // way would turn it back on and there would be no way to say no.
  assert.equal(withDefaults({ fragmentParam: null }).fragmentParam, null);
  assert.equal(withDefaults({ csrf: false }).csrf, false);
  assert.equal(withDefaults({ lang: 'fr' }).lang, 'fr');
});

test('no config at all is all the defaults', () => {
  assert.deepEqual(withDefaults(), DEFAULTS);
  assert.deepEqual(withDefaults(undefined), DEFAULTS);
});

// ---- where it is applied ---------------------------------------------------

const page = {
  layouts: [],
  css: '',
  headScript: '',
  hasTitle: false,
  renderTitle: () => '',
  renderHead: () => '',
  elements: [],
  regions: { list: () => '<p>the fragment</p>' },
  load: async () => ({}),
  render: () => ({ default: '<p>the whole document</p>' }),
};

/** An app built the way a worker builds one: the config exactly as written. */
const appWith = (config) =>
  createApp({
    config,
    manifest: { routes: [{ id: 'index', pattern: '/', params: [], client: null }], dynamic: [], endpoints: [] },
    pages: { index: page },
    statics: { get: () => null },
    assets: { get: () => null },
    hash: (body) => `"${body.length.toString(36)}"`,
    compress: null,
  });

test('a config that names no fragmentParam still answers a fragment request', async () => {
  // The bug, as a test. Seven deployed examples looked exactly like this.
  const out = await appWith({ csrf: false }).request('http://x/?fragment=list');
  const body = await out.text();

  assert.equal(out.status, 200);
  assert.match(body, /the fragment/);
  assert.doesNotMatch(body, /<!doctype/i, 'it answered a fragment request with the whole document');
});

test('a config that names one is unchanged', async () => {
  const app = appWith({ csrf: false, fragmentParam: 'part' });
  const out = await app.request('http://x/?part=list');

  assert.match(await out.text(), /the fragment/);
});

test('turning the parameter off is still possible', async () => {
  // If `createApp` merged the wrong way round this would answer the fragment,
  // and there would be no way to opt out of it at all.
  const app = appWith({ csrf: false, fragmentParam: null });
  const out = await app.request('http://x/?fragment=list');

  assert.match(await out.text(), /the whole document/);
});
