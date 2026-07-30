// The production app has to run where there is no filesystem.
//
// Two claims, both mechanical. One: nothing in the core's import graph names a
// runtime. Two: it answers requests with bytes handed to it, so a runtime that
// keeps its assets in a binding rather than a directory needs no change here.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp, COMPRESSIBLE_FLOOR } from '../src/app.js';

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

/** Every local module the core reaches, and every `node:` specifier on the way. */
function graphOf(entry) {
  const files = new Set();
  const node = [];

  const walk = (file) => {
    if (files.has(file)) return;
    files.add(file);
    for (const [, spec] of fs.readFileSync(file, 'utf8').matchAll(/from\s+'([^']+)'/g)) {
      if (spec.startsWith('node:')) node.push(`${path.basename(file)} -> ${spec}`);
      else if (spec.startsWith('.')) walk(path.resolve(path.dirname(file), spec));
    }
  };

  walk(entry);
  return { files: [...files].map((f) => path.basename(f)), node };
}

test('the core imports nothing from node:', () => {
  // The property that makes it portable. It is one import away from being lost,
  // and nothing else would notice. The Node server would keep working.
  const { node } = graphOf(path.join(src, 'app.js'));
  assert.deepEqual(node, [], `node: imports found: ${node.join(', ')}`);
});

test('the core reaches only the modules that are also portable', () => {
  const { files } = graphOf(path.join(src, 'app.js'));
  assert.deepEqual(files.sort(), ['app.js', 'cookies.js', 'document.js', 'negotiate.js', 'server.js']);
});

test('the core touches no Node-only global either', () => {
  // An import is not the only way to depend on a runtime. `Buffer` is a global,
  // so the graph check above cannot see it. Swapping `TextEncoder` for
  // `Buffer.from` broke nothing here, because the tests run on Node.
  const forbidden = /\b(Buffer|process|__dirname|__filename|require)\b/;
  const { files } = graphOf(path.join(src, 'app.js'));

  for (const name of files) {
    const source = fs.readFileSync(path.join(src, name), 'utf8');
    // Comments are allowed to name them; code is not.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const hit = forbidden.exec(code);
    assert.equal(hit, null, `${name} uses the Node-only global \`${hit?.[1]}\``);
  }
});

test('the Node wiring is where node: lives, and it is not in the core', () => {
  const wiring = fs.readFileSync(path.join(src, 'production.js'), 'utf8');
  assert.match(wiring, /from 'node:fs'/, 'the fs reads have to live somewhere');
  assert.match(wiring, /createApp\(/, 'and it has to hand them to the core');
});

// ---- running it with no filesystem ----------------------------------------

const bytes = (text) => new TextEncoder().encode(text);

const entryOf = (text, type = 'text/html; charset=utf-8') => ({
  body: bytes(text),
  etag: '"static"',
  encodings: new Map(),
  type,
});

const pageOf = (over = {}) => ({
  layouts: [],
  css: '',
  headScript: '',
  hasTitle: false,
  renderTitle: () => '',
  renderHead: () => '',
  elements: [],
  regions: { list: () => '<ul>region</ul>' },
  load: async () => ({}),
  render: () => ({ default: '<p>rendered</p>' }),
  ...over,
});

/** Everything a runtime with an asset binding would hand in, and nothing else. */
const inMemory = (over = {}) =>
  createApp({
    config: { csrf: false, trailingSlash: 'never', fragmentParam: 'fragment', cookieSecret: 's' },
    manifest: {
      routes: [{ id: 'index', pattern: '/', params: [], client: null }],
      dynamic: [],
      endpoints: [{ id: 'api-ping', pattern: '/api/ping', params: [] }],
    },
    pages: { index: pageOf() },
    endpoints: { 'api-ping': { GET: () => Response.json({ ok: true }) } },
    statics: { get: (p) => (p === '/about' ? entryOf('<p>prerendered</p>') : null) },
    assets: { get: (p) => (p === '/assets/app.js' ? entryOf('console.log(1)', 'text/javascript') : null) },
    notFound: entryOf('<p>not found</p>'),
    errorPage: entryOf('<p>broke</p>'),
    // No node:crypto. An ETag is a cache key, not a signature.
    hash: (body) => `"${body.length.toString(36)}"`,
    // A runtime that cannot compress says so, and the platform in front does it.
    compress: null,
    ...over,
  });

test('a rendered page comes back with no filesystem anywhere', async () => {
  const out = await inMemory().request('http://x/');
  assert.equal(out.status, 200);
  assert.match(await out.text(), /<p>rendered<\/p>/);
});

test('a prerendered entry is served from whatever handed it in', async () => {
  const out = await inMemory().request('http://x/about');
  assert.equal(await out.text(), '<p>prerendered</p>');
  assert.equal(out.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
});

test('a hashed asset is immutable', async () => {
  const out = await inMemory().request('http://x/assets/app.js');
  assert.equal(out.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(out.headers.get('content-type'), 'text/javascript');
});

test('a region still answers', async () => {
  const out = await inMemory().request('http://x/?fragment=list');
  assert.equal(await out.text(), '<ul>region</ul>');
});

test('an endpoint still answers', async () => {
  const out = await inMemory().request('http://x/api/ping');
  assert.deepEqual(await out.json(), { ok: true });
});

test('the not-found page is the handed-in one', async () => {
  const out = await inMemory().request('http://x/nope');
  assert.equal(out.status, 404);
  assert.equal(await out.text(), '<p>not found</p>');
});

test('a throw answers with the handed-in error page and no caching', async () => {
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args);

  const app = inMemory({ pages: { index: pageOf({ load: async () => { throw new Error('x'); } }) } });
  const out = await app.request('http://x/');

  console.error = original;
  assert.equal(out.status, 500);
  assert.equal(await out.text(), '<p>broke</p>');
  assert.equal(out.headers.get('cache-control'), 'no-store');
  assert.equal(out.headers.get('etag'), null, 'a failure is not a representation to revalidate');
  assert.equal(errors.length, 1, 'and the operator still gets told');
});

test('the trailing-slash redirect works without a runtime', async () => {
  const out = await inMemory().request('http://x/about/');
  assert.equal(out.status, 301);
});

test('a runtime that cannot compress sends identity, not a broken body', async () => {
  const long = '<p>' + 'x'.repeat(COMPRESSIBLE_FLOOR * 2) + '</p>';
  const app = inMemory({ pages: { index: pageOf({ render: () => ({ default: long }) }) } });

  const out = await app.request('http://x/', { headers: { 'Accept-Encoding': 'br, gzip' } });
  assert.equal(out.headers.get('content-encoding'), null);
  assert.match(await out.text(), /xxx/);
});

test('a runtime that can compress is used when it can', async () => {
  const long = '<p>' + 'x'.repeat(COMPRESSIBLE_FLOOR * 2) + '</p>';
  const app = inMemory({
    pages: { index: pageOf({ render: () => ({ default: long }) }) },
    compress: async (body) => bytes('squeezed'),
  });

  const out = await app.request('http://x/', { headers: { 'Accept-Encoding': 'br' } });
  assert.equal(out.headers.get('content-encoding'), 'br');
  assert.equal(await out.text(), 'squeezed');
});

test('the ETag comes from the injected hash, not from node:crypto', async () => {
  const app = inMemory({ hash: () => '"injected"' });
  const out = await app.request('http://x/');
  assert.equal(out.headers.get('etag'), '"injected"');
});

test('a conditional request is answered before anything is compressed', async () => {
  // The body has to be over the floor and the client has to accept an encoding,
  // or compression would not have been attempted either way and this proves
  // nothing. That is how it passed with the check in the wrong place.
  const long = '<p>' + 'x'.repeat(COMPRESSIBLE_FLOOR * 2) + '</p>';
  let compressed = 0;
  const app = inMemory({
    pages: { index: pageOf({ render: () => ({ default: long }) }) },
    compress: async (b) => (compressed++, b),
  });
  const accepts = { headers: { 'Accept-Encoding': 'br' } };

  const first = await app.request('http://x/', accepts);
  assert.equal(compressed, 1, 'the first request should have been compressed');

  const etag = first.headers.get('etag');
  const second = await app.request('http://x/', {
    headers: { ...accepts.headers, 'If-None-Match': etag },
  });

  assert.equal(second.status, 304);
  assert.equal(compressed, 1, 'a revalidating client should pay for a hash and nothing else');
});

// ---- the package boundary --------------------------------------------------

test('nothing in the package imports anything outside it', () => {
  // This is what makes it a package. It used to import `../../transclude.config.js`
  // from six files and work out the project root as two directories up from its
  // own, which is only true while it lives inside the app it serves. Installed,
  // two directories up is another package.
  //
  // `examples/` is in this repository and is still on the far side of the boundary.
  // It depends on the package by name, and nothing in the package may reach into
  // it.
  const offenders = [];

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) {
        const code = fs
          .readFileSync(full, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\/\/.*$/gm, '');
        // Module specifiers only. `cookies.js` names the config file in an error
        // message, which is the right thing for it to say.
        const specifiers = [
          ...code.matchAll(/from\s+'([^']+)'/g),
          ...code.matchAll(/import\('([^']+)'\)/g),
        ];
        for (const [, specifier] of specifiers) {
          const out =
            specifier.startsWith('../../') ||
            /transclude\.config/.test(specifier) ||
            /(^|\/)examples\//.test(specifier);
          if (out) offenders.push(`${full}: ${specifier}`);
        }
      }
    }
  };

  for (const dir of ['src', 'bin', 'editor']) walk(path.resolve(src, '..', dir));
  assert.deepEqual(offenders, [], `the package reaches out of itself:\n${offenders.join('\n')}`);
});

test('the project root is found from the working directory', () => {
  // The one place that decides where the app is. Everything else takes it as an
  // argument, so there is no second answer to get wrong.
  const source = fs.readFileSync(path.join(src, 'project.js'), 'utf8');
  assert.match(source, /process\.cwd\(\)/);
});

// ---- the worker helpers ----------------------------------------------------

test('the worker helpers import nothing from node:', () => {
  // The half of a worker entry that is not about one app. If this needs Node,
  // the split it exists for has stopped being real.
  const source = fs.readFileSync(path.join(src, 'worker.js'), 'utf8');

  assert.doesNotMatch(source, /from 'node:/, 'this file must not need Node');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /\b(Buffer|process|__dirname|require)\b/);
});

// ---- a header may name a region --------------------------------------------
//
// htmx sends `HX-Target` with the id of the element it is about to swap, which is
// exactly a region name. Reading it is server-side work and ships no client code.

const htmx = (over = {}) =>
  inMemory({
    config: {
      csrf: false,
      trailingSlash: 'never',
      fragmentParam: 'fragment',
      fragmentHeader: 'HX-Target',
      cookieSecret: 's',
    },
    ...over,
  });

test('a header naming a region gets the region', async () => {
  const out = await htmx().request('http://x/', { headers: { 'HX-Target': 'list' } });
  assert.equal(await out.text(), '<ul>region</ul>');
});

test('the query parameter still wins, because it is the explicit one', async () => {
  const out = await htmx().request('http://x/?fragment=list', { headers: { 'HX-Target': 'nope' } });
  assert.equal(await out.text(), '<ul>region</ul>');
});

test('a header naming something that is not a region is ignored, not a 404', async () => {
  // htmx sends it on every request, boosted ones included. Refusing those would
  // break more than it fixed.
  const out = await htmx().request('http://x/', { headers: { 'HX-Target': 'not-a-region' } });
  assert.equal(out.status, 200);
  assert.match(await out.text(), /<p>rendered<\/p>/);
});

test('an unknown region in the query is still a 404, since that one was typed', async () => {
  const out = await htmx().request('http://x/?fragment=not-a-region');
  assert.equal(out.status, 404);
});

test('a response that could have varied says so', async () => {
  const out = await htmx().request('http://x/');
  assert.equal(out.headers.get('vary'), 'Accept-Encoding, HX-Target');
});

test('with no header configured the cache key is not widened', async () => {
  const out = await inMemory().request('http://x/');
  assert.equal(out.headers.get('vary'), 'Accept-Encoding');
});

test('the header is off by default', async () => {
  // A cache key is a bad thing to widen for a feature an app may not use.
  const out = await inMemory().request('http://x/', { headers: { 'HX-Target': 'list' } });
  assert.match(await out.text(), /<p>rendered<\/p>/, 'it answered a region without being asked to');
});

test('ctx.fragment reflects a region named by the header', async () => {
  // Which is what lets an action return markup instead of a redirect.
  let saw = 'unset';
  const app = htmx({
    pages: { index: pageOf({ load: async (ctx) => ((saw = ctx.fragment), {}) }) },
  });

  await app.request('http://x/', { headers: { 'HX-Target': 'list' } });
  assert.equal(saw, 'list');

  await app.request('http://x/');
  assert.equal(saw, null, 'a whole document is null, not undefined');
});
