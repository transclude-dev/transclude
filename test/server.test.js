// The three things a backend has to be able to do that this could not:
// answer with something other than markup, run somebody's middleware, and be an
// endpoint rather than a page.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderFragment, renderRoute, responseOf } from '../src/document.js';
import { baseApp, endpointMethods, runEndpoint } from '../src/server.js';

/** Source with comments removed, so a guard cannot pass on the text explaining it. */
const codeOf = (url) =>
  fs
    .readFileSync(fileURLToPath(url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

const pageOf = (over = {}) => ({
  layouts: [],
  css: '',
  headScript: '',
  hasTitle: false,
  renderTitle: () => '',
  renderHead: () => '',
  elements: [],
  load: async () => ({}),
  render: () => ({ default: '<p>page</p>' }),
  regions: { list: () => '<ul></ul>' },
  ...over,
});

const layoutOf = (over = {}) => ({
  load: async () => ({}),
  render: (_d, slots) => ({ default: slots.default ?? '' }),
  css: '',
  headScript: '',
  hasTitle: false,
  renderTitle: () => '',
  renderHead: () => '',
  elements: [],
  ...over,
});

// ---- the response envelope ------------------------------------------------

test('a fresh envelope is a 200 and no headers', () => {
  const response = responseOf();
  assert.equal(response.status, 200);
  assert.deepEqual([...response.headers], []);
});

test('the envelope survives being handed through the chain', async () => {
  // Loaders are called with `{ ...ctx, layout }`. A scalar assigned onto that
  // copy would be lost; the envelope is shared because the copy carries the same
  // reference, and this is the test that says so.
  const ctx = { response: responseOf() };
  const page = pageOf({
    load: async (inner) => {
      inner.response.status = 404;
      inner.response.headers.set('HX-Trigger', 'missing');
      return {};
    },
  });

  await renderRoute(page, ctx);
  assert.equal(ctx.response.status, 404, 'the loader wrote to a copy nobody reads');
  assert.equal(ctx.response.headers.get('HX-Trigger'), 'missing');
});

test('every loader in the chain writes to the same envelope', async () => {
  const ctx = { response: responseOf() };
  const page = pageOf({
    layouts: [layoutOf({ load: async (i) => (i.response.headers.set('X-Layout', '1'), {}) })],
    load: async (i) => (i.response.headers.set('X-Page', '1'), {}),
  });

  await renderRoute(page, ctx);
  assert.equal(ctx.response.headers.get('X-Layout'), '1');
  assert.equal(ctx.response.headers.get('X-Page'), '1');
});

test('a loader answering with a Response is the answer, and nothing renders', async () => {
  const redirect = new Response(null, { status: 303, headers: { Location: '/in' } });
  let rendered = false;
  const page = pageOf({
    load: async () => redirect,
    render: () => ((rendered = true), { default: 'x' }),
  });

  const out = await renderRoute(page, { response: responseOf() });
  assert.equal(out, redirect);
  assert.equal(rendered, false);
});

test('a layout can answer for the page, which is what makes auth a layout', async () => {
  // Nothing below it runs. Not the page's loader, not its render.
  let pageLoaded = false;
  const page = pageOf({
    layouts: [layoutOf({ load: async () => new Response(null, { status: 302 }) })],
    load: async () => ((pageLoaded = true), {}),
  });

  const out = await renderRoute(page, { response: responseOf() });
  assert.equal(out.status, 302);
  assert.equal(pageLoaded, false, 'a guard that runs after the thing it guards is not a guard');
});

test('a region request can be answered with a Response too', async () => {
  const page = pageOf({ load: async () => new Response(null, { status: 401 }) });
  const out = await renderFragment(page, { response: responseOf() }, { region: 'list' });
  assert.equal(out.status, 401);
});

test('rendering still returns markup when nobody answered', async () => {
  const out = await renderRoute(pageOf(), { response: responseOf() });
  assert.equal(typeof out, 'string');
  assert.match(out, /<p>page<\/p>/);
});

// ---- endpoints ------------------------------------------------------------

test('a handler is found by the method, spelled the way HTTP spells it', async () => {
  const mod = { GET: () => Response.json({ ok: true }) };
  const out = await runEndpoint(mod, {}, 'GET');
  assert.equal(out.status, 200);
  assert.deepEqual(await out.json(), { ok: true });
});

test('the method is matched case-insensitively, because a router may not shout', async () => {
  const mod = { POST: () => new Response('made', { status: 201 }) };
  assert.equal((await runEndpoint(mod, {}, 'post')).status, 201);
});

test('DELETE is a legal export name, which is why these are not an object', async () => {
  // `export const delete` is a syntax error; this is not. A page's `actions` had
  // to be keyed by string for exactly that reason.
  const mod = { DELETE: () => new Response(null, { status: 204 }) };
  assert.equal((await runEndpoint(mod, {}, 'DELETE')).status, 204);
});

test('a method the module does not export is null, so the caller can say 405', async () => {
  assert.equal(await runEndpoint({ GET: () => new Response('x') }, {}, 'PUT'), null);
});

test('a handler that forgets to return a Response says so', async () => {
  // There is no template to fall back to, so guessing would be worse than this.
  await assert.rejects(
    () => runEndpoint({ GET: () => ({ people: [] }) }, {}, 'GET'),
    /not a Response/,
  );
  await assert.rejects(() => runEndpoint({ GET: () => {} }, {}, 'GET'), /answered with nothing/);
});

test('the methods it answers are readable, for an Allow header', () => {
  const mod = { GET: () => {}, DELETE: () => {}, shape: () => {}, count: 3 };
  assert.deepEqual(endpointMethods(mod), ['DELETE', 'GET'], 'a helper is not a verb');
  assert.deepEqual(endpointMethods(null), []);
});

test('an all-caps helper is not a method, however it is spelled', () => {
  // The rule used to be "any all-caps export", which a lowercase helper passes
  // and `HELPERS` does not. Only the lowercase case was covered, so this held
  // for years while being wrong.
  const mod = { GET: () => {}, HELPERS: () => {}, LIMIT: 10 };
  assert.deepEqual(endpointMethods(mod), ['GET']);
});

test('a request naming a helper cannot reach it', async () => {
  let called = false;
  const mod = { HELPERS: () => ((called = true), new Response('x')) };

  assert.equal(await runEndpoint(mod, {}, 'HELPERS'), null, 'not a method, so not routed');
  assert.equal(called, false);
});

test('an endpoint is handed the same context a loader is', async () => {
  let saw = null;
  const ctx = { url: 'http://x/api', params: { id: '1' }, request: new Request('http://x/api') };
  await runEndpoint({ GET: (c) => ((saw = c), new Response('x')) }, ctx, 'GET');
  assert.equal(saw, ctx);
});

// ---- the app both servers start from --------------------------------------

const request = (app, url, init) => app.request(url, init);

test('CSRF is on by default and refuses a cross-origin form post', async () => {
  const app = baseApp();
  app.post('/notes', (c) => c.text('mutated'));

  const out = await request(app, 'http://x/notes', {
    method: 'POST',
    headers: { Origin: 'https://evil.example', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'text=x',
  });
  assert.equal(out.status, 403);
});

test('a same-origin form post is not refused', async () => {
  const app = baseApp();
  app.post('/notes', (c) => c.text('mutated'));

  const out = await request(app, 'http://x/notes', {
    method: 'POST',
    headers: { Origin: 'http://x', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'text=x',
  });
  assert.equal(out.status, 200);
});

test('a GET is never refused, whatever origin it claims', async () => {
  const app = baseApp();
  app.get('/', (c) => c.text('read'));
  const out = await request(app, 'http://x/', { headers: { Origin: 'https://evil.example' } });
  assert.equal(out.status, 200);
});

test('csrf: false turns it off', async () => {
  const app = baseApp({ csrf: false });
  app.post('/notes', (c) => c.text('mutated'));

  const out = await request(app, 'http://x/notes', {
    method: 'POST',
    headers: { Origin: 'https://evil.example', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'text=x',
  });
  assert.equal(out.status, 200);
});

test('an object is passed through as options, which is how another origin is allowed', async () => {
  const app = baseApp({ csrf: { origin: 'https://admin.example' } });
  app.post('/notes', (c) => c.text('mutated'));

  const allowed = await request(app, 'http://x/notes', {
    method: 'POST',
    headers: { Origin: 'https://admin.example', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'text=x',
  });
  const refused = await request(app, 'http://x/notes', {
    method: 'POST',
    headers: { Origin: 'https://evil.example', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'text=x',
  });
  assert.equal(allowed.status, 200);
  assert.equal(refused.status, 403);
});

test("the app's own middleware runs, and runs after the guard", async () => {
  // After, on purpose. Middleware cannot register itself ahead of CSRF and answer
  // a forged request before it is checked.
  const order = [];
  const app = baseApp({
    middleware: (a) =>
      a.use('*', async (c, next) => {
        order.push('middleware');
        await next();
      }),
  });
  app.post('/notes', (c) => (order.push('route'), c.text('ok')));

  const forged = await request(app, 'http://x/notes', {
    method: 'POST',
    headers: { Origin: 'https://evil.example', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'x=1',
  });
  assert.equal(forged.status, 403);
  assert.deepEqual(order, [], 'the guard has to be first or it guards nothing');
});

test('middleware sees every route registered after it', async () => {
  const app = baseApp({ middleware: (a) => a.use('*', async (c, next) => { await next(); c.header('X-Ran', '1'); }) });
  app.get('/', (c) => c.text('x'));

  const out = await request(app, 'http://x/');
  assert.equal(out.headers.get('X-Ran'), '1');
});

test('no middleware is not an error', () => {
  assert.doesNotThrow(() => baseApp({ middleware: null }));
  assert.doesNotThrow(() => baseApp({ middleware: 'not a function' }));
});

// ---- one canonical URL -----------------------------------------------------

const canonical = (mode) => {
  const app = baseApp({ trailingSlash: mode, csrf: false });
  app.get('/check', (c) => c.text('page'));
  app.get('/', (c) => c.text('root'));
  return app;
};

test("'never' redirects a trailing slash to the URL without one", async () => {
  const out = await canonical('never').request('http://x/check/');
  assert.equal(out.status, 301, '302 would let a client keep using the other URL');
  assert.equal(out.headers.get('location'), 'http://x/check');
});

test('the query string survives the redirect', async () => {
  const out = await canonical('never').request('http://x/check/?q=ada');
  assert.equal(out.headers.get('location'), 'http://x/check?q=ada');
});

test('the root is not redirected to the empty string', async () => {
  assert.equal((await canonical('never').request('http://x/')).status, 200);
});

test('a URL with no trailing slash is left alone', async () => {
  assert.equal((await canonical('never').request('http://x/check')).status, 200);
});

test("'ignore' answers both, which is two URLs for one page", async () => {
  assert.equal((await canonical('ignore').request('http://x/check/')).status, 200);
  assert.equal((await canonical('ignore').request('http://x/check')).status, 200);
});

test('the loose router strips the slash before anything can act on it', async () => {
  // This is why `trailingSlash` is one key and not a router option plus a
  // middleware: under 'ignore' the slash is gone from `c.req.path` before any
  // middleware runs, so a redirect middleware added alongside could never fire.
  // The two exclude each other rather than composing.
  let seen = null;
  const app = baseApp({ trailingSlash: 'ignore', csrf: false });
  app.use('*', async (c, next) => ((seen = c.req.path), next()));
  app.get('/check', (c) => c.text('x'));

  await app.request('http://x/check/');
  assert.equal(seen, '/check', 'if this were "/check/" the two options could compose');
});

test('a catch-all route does not get to answer the slashed form first', async () => {
  // Hono's default only redirects a request that already 404'd, and `:path{.+}`
  // matches `intro/` happily, so without `alwaysRedirect` the slashed URL serves
  // content and the duplicate survives.
  const app = baseApp({ trailingSlash: 'never', csrf: false });
  app.get('/docs/:path{.+}', (c) => c.text(`doc:${c.req.param('path')}`));

  const out = await app.request('http://x/docs/intro/');
  assert.equal(out.status, 301, 'the catch-all swallowed it');
  assert.equal(out.headers.get('location'), 'http://x/docs/intro');
});

test('a nonsense value is refused rather than silently ignored', () => {
  assert.throws(() => baseApp({ trailingSlash: 'always' }), /'never' or 'ignore'/);
  assert.throws(() => baseApp({ trailingSlash: true }), /'never' or 'ignore'/);
});

// ---- public files ----------------------------------------------------------

/** What Node hands in is Hono's serveStatic; a test hands in something smaller. */
const filesFrom = (map) => async (c, next) => {
  const body = map[c.req.path];
  return body === undefined ? next() : c.text(body);
};

test('a public file beats a route, and a miss falls through', async () => {
  const app = baseApp({ csrf: false, publicFiles: filesFrom({ '/robots.txt': 'User-agent: *' }) });
  app.get('/robots.txt', (c) => c.text('a route, which should never be reached'));
  app.get('/missing.txt', (c) => c.text('fell through'));

  assert.equal(await (await app.request('http://x/robots.txt')).text(), 'User-agent: *');
  assert.equal(await (await app.request('http://x/missing.txt')).text(), 'fell through');
});

test("the app's middleware sees public file requests too", async () => {
  // Mounted after the middleware, so a guard covers these as well. A file being
  // public by default is not the same as one a guard cannot cover.
  const seen = [];
  const app = baseApp({
    csrf: false,
    publicFiles: filesFrom({ '/secret.txt': 'shh' }),
    middleware: (a) => a.use('*', async (c, next) => (seen.push(c.req.path), next())),
  });

  assert.equal(await (await app.request('http://x/secret.txt')).text(), 'shh');
  assert.deepEqual(seen, ['/secret.txt'], 'middleware registered after this could not guard it');
});

test('a guard can refuse a public file', async () => {
  const app = baseApp({
    csrf: false,
    publicFiles: filesFrom({ '/private.txt': 'shh' }),
    middleware: (a) => a.use('/private.txt', (c) => c.text('nope', 403)),
  });
  assert.equal((await app.request('http://x/private.txt')).status, 403);
});

test('a key baseApp does not know is refused, not ignored', () => {
  // `publicRoot` instead of `publicFiles` cost dev every public file it had.
  // Production served them, dev 404'd, and the only sign was a Vite warning
  // about one of the three files.
  assert.throws(
    () => baseApp({ csrf: false, publicRoot: '/tmp' }),
    /does not know publicRoot/,
  );
});

test('both servers mount the public directory', () => {
  // The other half of the same bug: omitting the key is still legal, so refusing
  // an unknown one does not cover a server that simply never passes it.
  for (const file of ['../bin/dev.js', '../src/production.js']) {
    const source = codeOf(new URL(file, import.meta.url));
    assert.match(source, /publicFiles\s*[,:]/, `${file} passes no publicFiles`);
    assert.match(source, /serveStatic\(/, `${file} mounts nothing to serve them`);
  }
});

test('the dev server hands its own http server to Vite for HMR', () => {
  // Without this Vite runs its WebSocket on a second port, the browser refuses
  // that socket as cross-origin, and every edit needs a manual reload. The file
  // watcher and the module graph are unaffected, so the server logs an update
  // it delivered to nobody. Nothing but the browser can see the difference,
  // which is why this reads the source.
  const source = codeOf(new URL('../bin/dev.js', import.meta.url));

  assert.match(source, /hmr:\s*{\s*server\s*}/, 'Vite gets no hmr.server');
  // The server has to exist before Vite does, or there is nothing to pass.
  assert.ok(
    source.indexOf('http.createServer()') < source.indexOf('createViteServer('),
    'the http server is built after Vite, so it cannot be handed over',
  );
});

test('no handler, and nothing is mounted', async () => {
  // Whether there is anything to serve is the adapter's question, not this one's:
  // Node checks the directory exists, a runtime with a binding checks the binding.
  const app = baseApp({ csrf: false, publicFiles: null });
  app.get('/robots.txt', (c) => c.text('the route answers'));
  assert.equal(await (await app.request('http://x/robots.txt')).text(), 'the route answers');
});

// ---- the adapters ----------------------------------------------------------
//
// Three files that only listen. The app is `app.fetch`, which is
// (Request) => Response, so what is worth checking here is that the split really
// happened and no adapter grew logic of its own.

test('production.js exports an app and nothing runtime-specific runs on import', async () => {
  // It loads the config of whatever project it is run in, so a project is what
  // this has to give it. Before the framework moved out of the app it served,
  // there was always one two directories up and this needed no fixture.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'transclude-'));
  fs.writeFileSync(
    path.join(dir, 'transclude.config.js'),
    "export default { appDir: 'app', routesDir: 'routes', outDir: 'dist' };\n",
  );

  const was = process.cwd();
  process.chdir(dir);
  try {
    // Importing it must not bind a port; that is the adapter's job.
    const mod = await import('../src/production.js');
    assert.equal(typeof mod.app?.fetch, 'function');
    assert.equal(typeof mod.summary, 'function');
    assert.equal(typeof mod.noBuild, 'boolean');
  } finally {
    process.chdir(was);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('each adapter is a listener and nothing else', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  for (const file of ['bin/serve.js', 'bin/serve.bun.js', 'bin/serve.deno.js']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');

    assert.match(source, /from '\.\.\/src\/production\.js'/, `${file} does not use the shared app`);
    // Logic here is logic three runtimes have to keep in sync by hand.
    for (const leaked of ['loadStatic', 'renderRoute', 'runAction', 'baseApp', 'manifest']) {
      assert.doesNotMatch(source, new RegExp(leaked), `${file} has ${leaked} in it`);
    }
    assert.ok(source.split('\n').length < 20, `${file} is too long to be only a listener`);
  }
});

test('the summary is shared, so three adapters cannot disagree about it', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  for (const file of ['bin/serve.js', 'bin/serve.bun.js', 'bin/serve.deno.js']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(source, /summary\(/, `${file} prints its own thing`);
    assert.doesNotMatch(source, /prerendered/, `${file} reimplements the summary`);
  }
});
