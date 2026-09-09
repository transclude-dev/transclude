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
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULTS, KEYS, withDefaults } from '../src/defaults.js';
import { createApp } from '../src/app.js';
import { baseApp } from '../src/server.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

test('the default typesFile follows appDir', () => {
  // It is a path from the root, and its default used to write `app/` into
  // itself. So an app that moved `appDir` kept its declarations in a directory
  // it no longer had, and heard about it as an ENOENT naming a path nobody
  // wrote. The value an author writes is still read from the root.
  assert.equal(withDefaults({ appDir: 'src' }).typesFile, 'src/transclude-env.d.ts');
  assert.equal(
    withDefaults({ appDir: 'src', typesFile: 'types/env.d.ts' }).typesFile,
    'types/env.d.ts',
  );
  assert.equal(withDefaults().typesFile, DEFAULTS.typesFile);
});

// ---- a key nothing reads ---------------------------------------------------
//
// An ignored key looks exactly like a key that worked, and the cost is not
// theoretical: `stylesheeet` for `stylesheet` takes a site's whole stylesheet
// away and says nothing. The docs claimed this throw for a long time before
// anything did.

test('an empty cookieSecret is refused at boot, not at the first signed cookie', () => {
  // The lazy throw in `cookiesOf` fires in production, at request time, days
  // after the deploy that broke it. This one fires where CI can see it.
  assert.throws(() => withDefaults({ cookieSecret: '' }), /empty string.*wrangler/s);
  assert.equal(withDefaults({ cookieSecret: null }).cookieSecret, null);
  assert.equal(withDefaults({ cookieSecret: 's3cret' }).cookieSecret, 's3cret');
});

test('a key nothing reads is refused, and named', () => {
  assert.throws(
    () => withDefaults({ stylesheeet: 'app/styles/global.css' }),
    /stylesheeet, which nothing reads/,
  );
});

test('the refusal lists the keys there are, because the reader is looking for one', () => {
  try {
    withDefaults({ nope: 1 });
    assert.fail('an unknown key was accepted');
  } catch (error) {
    // The whole set, so a misspelling is corrected by reading rather than by
    // searching the site.
    for (const key of ['stylesheet', 'metadataBase', 'canonical', 'cache']) {
      assert.match(error.message, new RegExp(`\\b${key}\\b`), `the message left out ${key}`);
    }
  }
});

test('every key with a default is a key that may be set', () => {
  // Two lists, and the second is the one a config is checked against. A key
  // added to `DEFAULTS` alone would be filled in and then refused.
  for (const key of Object.keys(DEFAULTS)) {
    assert.ok(KEYS.has(key), `${key} has a default and would be refused`);
  }
});

test('a key with no default is still a key that may be set', () => {
  // These are the ones the check exists to get wrong: nothing fills them in, so
  // nothing but this list says they are real.
  assert.doesNotThrow(() =>
    withDefaults({
      cache: { get() {}, set() {}, delete() {}, deleteByTag() {} },
      cookieSecret: 's',
      feed: { hostname: 'https://acme.com', title: 'Acme', items: () => [] },
      fragmentHeader: 'HX-Target',
      metadataBase: 'https://acme.com',
      onError: () => {},
      port: 3000,
      precache: true,
      proxy: { allow: ['acme.com'] },
      sitemap: { hostname: 'https://acme.com' },
      watchElements: true,
    }),
  );
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

// ---- the type and the runtime ----------------------------------------------

// The `Config` typedef ships. `tsconfig.types.json` emits it to
// `types/api/defaults.d.ts`, so what it says is what an app's editor says.
//
// `trailingSlash` named `'never'|'always'|'ignore'` and nothing ever implemented
// the middle one: `baseApp` threw on it, `test/server.test.js` asserted the
// throw, `/docs/config` listed two values, and this table handed the third to
// every generated project. `csrf` and `fragmentParam` drifted the other way and
// promised less than the runtime takes, so an app writing what the docs said got
// an error from its editor instead.
//
// A text check, because a type is a comment and there is nothing else to read it
// from. What it catches is the failure that already happened: a union that
// nobody made the runtime agree with.

/** The `@typedef` block, as written. */
function configType() {
  const source = fs.readFileSync(path.join(root, 'src/defaults.js'), 'utf8');
  const at = source.indexOf(' * @typedef {{');
  const end = source.indexOf('}} Config', at);

  assert.notEqual(at, -1, 'the Config typedef moved');
  assert.notEqual(end, -1, 'the Config typedef moved');
  return source.slice(at, end);
}

/**
 * What a key's type names, one member per entry.
 *
 * @param {string} key
 * @returns {string[]}
 */
function unionFor(key) {
  const line = configType()
    .split('\n')
    .find((one) => one.includes(`${key}?:`));

  assert.ok(line, `the Config typedef no longer names ${key}`);
  return line
    .slice(line.indexOf('?:') + 2)
    .replace(/,\s*$/, '')
    .split('|')
    .map((one) => one.trim().replace(/^'|'$/g, ''));
}

test('every trailingSlash the type names is one baseApp takes', () => {
  const named = unionFor('trailingSlash');
  assert.deepEqual(named, ['never', 'ignore'], 'the union moved: make baseApp agree, or put it back');

  for (const value of named) {
    assert.doesNotThrow(
      () => baseApp({ trailingSlash: value }),
      `the type names ${value} and baseApp refuses it`,
    );
  }
});

test('csrf and fragmentParam promise what the runtime takes', () => {
  assert.ok(unionFor('csrf').includes('object'), 'csrf takes an object, and the type should say so');
  assert.ok(unionFor('fragmentParam').includes('null'), 'null turns the parameter off');

  assert.doesNotThrow(() => baseApp({ csrf: { origin: 'https://acme.com' } }));
  assert.equal(withDefaults({ fragmentParam: null }).fragmentParam, null);
});
