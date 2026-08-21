// What the plugin compiles when Vite asks for a virtual module.
//
// `plugin.test.js` covers registering the plugin. This covers the hook that
// answers afterwards, which is where the rule about which pages ship JavaScript
// lives. A page module carries that rule out as `export const client`, so the
// assertions read it back rather than guessing from the bundle.
//
// A real resolved config, because `configResolved` is what scans the app and
// nothing else models a route table.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveConfig } from 'vite';

import transclude from '../src/plugin.js';

const SERVER_ENTRY = 'virtual:transclude-server';
const ELEMENTS_ENTRY = 'virtual:transclude-elements';

/** An app on disk, resolved the way a bin resolves one. */
async function project(files, options = {}) {
  // `realpathSync`, because on macOS `os.tmpdir()` is a symlink into
  // `/private` and Vite resolves the root through it. Paths that disagree
  // make the watcher's "is this file in the app" check answer no for every
  // file in the app.
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tc-load-')));
  for (const [rel, body] of Object.entries(files)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  }
  const plugin = transclude({ appDir: 'app', ...options });
  await resolveConfig(
    { root: dir, plugins: [plugin], logLevel: 'silent', publicDir: false, configFile: false },
    'build',
  );
  plugin.root = dir;
  return plugin;
}

/**
 * As much of a Vite dev server as `configureServer` touches: something to
 * register a watcher on, a module graph to invalidate, and a channel to the
 * browser.
 */
function devServer({ channel = 'hot' } = {}) {
  const handlers = [];
  const invalidated = [];
  const sent = [];
  const server = {
    watcher: { on: (event, fn) => event === 'all' && handlers.push(fn) },
    moduleGraph: {
      idToModuleMap: new Map(),
      invalidateModule: (mod) => invalidated.push(mod.id),
    },
    [channel]: { send: (message) => sent.push(message) },
  };
  const touch = (file) => handlers.forEach((fn) => fn('change', file));
  return { server, touch, invalidated, sent };
}

const codeOf = (out) => (typeof out === 'string' ? out : out.code);

/** What a page module says it needs in the browser. */
function manifest(plugin, name) {
  const code = codeOf(plugin.load(`virtual:transclude-page/${name}`));
  const found = code.match(/export const client = (\{.*\});/);
  assert.ok(found, `no client manifest in the module for "${name}"`);
  return JSON.parse(found[1]);
}

const SCRIPTED = "<button>go</button>\n<script>\nhost.dataset.ready = 'yes';\n</script>\n";
const QUIET = '<p class="note"><slot></slot></p>\n';

// ---- the two entries -------------------------------------------------------

test('the server entry pulls every page, endpoint and the middleware into one graph', async () => {
  const plugin = await project({
    'app/routes/index.html': '<h1>Home</h1>\n',
    'app/routes/about.html': '<h1>About</h1>\n',
    'app/routes/api/ping.js': 'export const GET = () => Response.json({ ok: true });\n',
    'app/server.js': "export default (app) => app;\nexport const gated = ['/api/*'];\n",
  });

  const code = plugin.load(SERVER_ENTRY);

  assert.match(code, /virtual:transclude-page\/index/);
  assert.match(code, /virtual:transclude-page\/about/);
  assert.match(code, /"api-ping":/);
  assert.match(code, /export const middleware = __server\.default \?\? null;/);
  assert.match(code, /export const gated = __server\.gated \?\? \[\];/);
});

test('an app with no server.js has no middleware and gates nothing', async () => {
  // The production server reads `dist` and nothing else, so these two exports
  // exist either way. Leaving them out would make the entry a different shape
  // depending on a file the app may not have.
  const plugin = await project({ 'app/routes/index.html': '<h1>Home</h1>\n' });

  const code = plugin.load(SERVER_ENTRY);

  assert.match(code, /export const middleware = null;/);
  assert.match(code, /export const gated = \[\];/);
});

test('the elements entry names every element, not only the rendered ones', async () => {
  // A fragment can name any element in the app, and which one it names is a
  // runtime fact. An entry holding only what some page renders would leave a
  // swapped-in element with no definition to load.
  const plugin = await project({
    'app/routes/index.html': '<h1>Home</h1>\n',
    'app/elements/never-used.html': QUIET,
    'app/elements/also-unused.html': QUIET,
  });

  const code = plugin.load(ELEMENTS_ENTRY);

  assert.match(code, /"never-used": \(\) => import\("virtual:transclude-component\/never-used"\)/);
  assert.match(code, /"also-unused": \(\) => import\("virtual:transclude-component\/also-unused"\)/);
});

// ---- which pages ship JavaScript ------------------------------------------

test('a page of plain markup ships nothing', async () => {
  const plugin = await project({ 'app/routes/index.html': '<h1>Home</h1>\n' });

  assert.deepEqual(manifest(plugin, 'index'), { tags: [], hasScript: false, needed: false });
});

test('a light element with no behavior needs no definition', async () => {
  // It is markup the server already rendered. Registering a class for it would
  // be the page shipping JavaScript to do nothing.
  const plugin = await project({
    'app/routes/index.html': '<h1>Home</h1>\n<quiet-note>hi</quiet-note>\n',
    'app/elements/quiet-note.html': QUIET,
  });

  assert.deepEqual(manifest(plugin, 'index'), { tags: [], hasScript: false, needed: false });
});

test('a light element with behavior ships its own definition', async () => {
  const plugin = await project({
    'app/routes/index.html': '<h1>Home</h1>\n<has-script></has-script>\n',
    'app/elements/has-script.html': SCRIPTED,
  });

  assert.deepEqual(manifest(plugin, 'index'), {
    tags: ['has-script'],
    hasScript: true,
    needed: true,
  });
});

test('a shadow element ships even with no script of its own', async () => {
  // It has a root to attach and structure to rebuild, so it needs a class in
  // the browser whatever else is true about it.
  const plugin = await project({
    'app/routes/index.html': '<h1>Home</h1>\n<boxed-card>hi</boxed-card>\n',
    'app/elements/boxed-card.html':
      '<article><slot></slot></article>\n<script properties>\nexport const shadow = true;\nexport default {};\n</script>\n',
  });

  assert.deepEqual(manifest(plugin, 'index').tags, ['boxed-card']);
});

test('an element reached only through a light one still ships', async () => {
  // `quiet-note` needs no definition and renders `deep-leaf`, which does.
  // Reading the page alone would leave the leaf in the markup with no class
  // behind it, so the walk opens every light element it meets.
  const plugin = await project({
    'app/routes/index.html': '<h1>Home</h1>\n<quiet-note></quiet-note>\n',
    'app/elements/quiet-note.html': '<p><deep-leaf></deep-leaf></p>\n',
    'app/elements/deep-leaf.html': SCRIPTED,
  });

  assert.deepEqual(manifest(plugin, 'index').tags, ['deep-leaf']);
});

test('an element reached only through a shadow one still ships', async () => {
  // The walk above stops at a shadow element, because a shadow root renders in
  // the browser rather than inline. So this is the case the closure alone
  // catches: `boxed-card` re-renders and produces a `deep-leaf` that needs a
  // definition by the time it does.
  const plugin = await project({
    'app/routes/index.html': '<h1>Home</h1>\n<boxed-card></boxed-card>\n',
    'app/elements/boxed-card.html':
      '<article><deep-leaf></deep-leaf></article>\n<script properties>\nexport const shadow = true;\nexport default {};\n</script>\n',
    'app/elements/deep-leaf.html': SCRIPTED,
  });

  assert.deepEqual(manifest(plugin, 'index').tags, ['boxed-card', 'deep-leaf']);
});

test('an element in the root layout costs every page under it', async () => {
  // The same shape as a cookie read in the root layout: what is written once at
  // the top is paid for by everything below. `quiet.html` names no element and
  // still ships one.
  const plugin = await project({
    'app/routes/_layout.html': '<header><has-script></has-script></header>\n<slot></slot>\n',
    'app/routes/quiet.html': '<h1>Quiet</h1>\n',
    'app/elements/has-script.html': SCRIPTED,
  });

  assert.deepEqual(manifest(plugin, 'quiet').tags, ['has-script']);
});

test('watchElements makes every page carry the loader', async () => {
  // Off by default. On, a page needs the script that defines whatever a swap
  // brings in, including a page that renders no element at all.
  const plain = { 'app/routes/index.html': '<h1>Home</h1>\n' };

  assert.equal(manifest(await project(plain), 'index').needed, false);
  assert.equal(manifest(await project(plain, { watchElements: true }), 'index').needed, true);
});

// ---- the client entry ------------------------------------------------------

test('the client entry defines exactly what the manifest named', async () => {
  const plugin = await project({
    'app/routes/index.html': '<h1>Home</h1>\n<quiet-note></quiet-note>\n<has-script></has-script>\n',
    'app/elements/quiet-note.html': '<p><deep-leaf></deep-leaf></p>\n',
    'app/elements/deep-leaf.html': SCRIPTED,
    'app/elements/has-script.html': SCRIPTED,
  });

  const code = codeOf(plugin.load('virtual:transclude-client/index'));

  assert.match(code, /virtual:transclude-component\/deep-leaf/);
  assert.match(code, /virtual:transclude-component\/has-script/);
  assert.doesNotMatch(code, /virtual:transclude-component\/quiet-note/);
});

// ---- what it refuses -------------------------------------------------------

test('an id that is not this plugin s is left alone', async () => {
  const plugin = await project({ 'app/routes/index.html': '<h1>Home</h1>\n' });

  assert.equal(plugin.load('/app/lib/notes.js'), null);
  assert.equal(plugin.load('some-package/index.js'), null);
});

test('a missing element and a missing page each throw, naming what was wanted', async () => {
  // The message names the thing, because the id is virtual and a stack trace
  // pointing at a generated module says nothing about which file to open.
  const plugin = await project({ 'app/routes/index.html': '<h1>Home</h1>\n' });

  assert.throws(() => plugin.load('virtual:transclude-component/nope'), /no element <nope>/);
  assert.throws(() => plugin.load('virtual:transclude-page/nope'), /no page "nope"/);
  assert.throws(() => plugin.load('virtual:transclude-layout/nope'), /no layout "nope"/);
});

// ---- the dev server watcher ------------------------------------------------

test('editing a page invalidates the virtual modules and reloads the browser', async () => {
  const plugin = await project({ 'app/routes/index.html': '<h1>Home</h1>\n' });
  const { server, touch, invalidated, sent } = devServer();
  server.moduleGraph.idToModuleMap.set(SERVER_ENTRY, { id: SERVER_ENTRY });
  server.moduleGraph.idToModuleMap.set('/app/lib/notes.js', { id: '/app/lib/notes.js' });
  plugin.configureServer(server);

  touch(path.join(plugin.root, 'app', 'routes', 'index.html'));

  assert.deepEqual(invalidated, [SERVER_ENTRY], 'a real module was dropped, or a virtual one kept');
  assert.deepEqual(sent, [{ type: 'full-reload' }]);
});

test('editing a Markdown page counts as editing a page', async () => {
  const plugin = await project({ 'app/routes/index.html': '<h1>Home</h1>\n' });
  const { server, touch, sent } = devServer();
  plugin.configureServer(server);

  touch(path.join(plugin.root, 'app', 'routes', 'notes.md'));

  assert.deepEqual(sent, [{ type: 'full-reload' }]);
});

test('adding a page is picked up without a restart', async () => {
  // The assertion that the rescan happened, rather than that something was
  // invalidated. A watcher that reloads the browser and reads a stale route
  // table sends it back to the same 404.
  const plugin = await project({ 'app/routes/index.html': '<h1>Home</h1>\n' });
  const { server, touch } = devServer();
  plugin.configureServer(server);

  assert.doesNotMatch(plugin.load(SERVER_ENTRY), /virtual:transclude-page\/about/);

  const added = path.join(plugin.root, 'app', 'routes', 'about.html');
  fs.writeFileSync(added, '<h1>About</h1>\n');
  touch(added);

  assert.match(plugin.load(SERVER_ENTRY), /virtual:transclude-page\/about/);
});

test('a file outside the app is not the app changing', async () => {
  // The watcher is Vite's and it reports the whole root. A README at the top
  // of the project would otherwise rescan and reload on every keystroke.
  const plugin = await project({ 'app/routes/index.html': '<h1>Home</h1>\n' });
  const { server, touch, sent } = devServer();
  plugin.configureServer(server);

  touch(path.join(plugin.root, 'notes.html'));
  touch(path.join(plugin.root, 'app', 'styles.css'));

  assert.deepEqual(sent, []);
});

test('an older Vite is reached through ws rather than hot', async () => {
  const plugin = await project({ 'app/routes/index.html': '<h1>Home</h1>\n' });
  const { server, touch, sent } = devServer({ channel: 'ws' });
  plugin.configureServer(server);

  touch(path.join(plugin.root, 'app', 'routes', 'index.html'));

  assert.deepEqual(sent, [{ type: 'full-reload' }]);
});

// ---- resolving an import written inside a page -----------------------------

test('the virtual ids are claimed and nothing else is', async () => {
  const plugin = await project({ 'app/routes/index.html': '<h1>Home</h1>\n' });

  assert.equal(plugin.resolveId(ELEMENTS_ENTRY), ELEMENTS_ENTRY);
  assert.equal(plugin.resolveId('virtual:transclude-component/x'), 'virtual:transclude-component/x');
  assert.equal(plugin.resolveId('virtual:transclude-layout/root'), 'virtual:transclude-layout/root');
  assert.equal(plugin.resolveId('virtual:transclude-client/index'), 'virtual:transclude-client/index');
  assert.equal(plugin.resolveId('hono'), null);
});

test("a relative import in a loader resolves against the page's own directory", async () => {
  // A virtual module has no directory, so Vite cannot resolve `../data/notes.js`
  // on its own: it would look beside a module that is not on disk. The block was
  // authored in a real file, and that file's directory is the one that answers.
  const plugin = await project({
    'app/data/notes.js': 'export const notes = [];\n',
    'app/routes/deep/index.html':
      "<script server>import { notes } from '../../data/notes.js';\nexport default () => ({ notes });</script>\n<p>x</p>\n",
  });

  // `load` is what records where a virtual module was written, so the page has
  // to be compiled before its imports can be resolved.
  plugin.load('virtual:transclude-page/deep-index');

  assert.equal(
    plugin.resolveId('../../data/notes.js', 'virtual:transclude-page/deep-index'),
    path.join(plugin.root, 'app', 'data', 'notes.js'),
  );
});

test('a relative import is only resolved for a module that was compiled', async () => {
  // Nothing has been loaded, so there is no file to resolve against and the
  // answer is Vite's to make rather than a path guessed from the root.
  const plugin = await project({ 'app/routes/index.html': '<h1>Home</h1>\n' });

  assert.equal(plugin.resolveId('../data/notes.js', 'virtual:transclude-page/index'), null);
});

test('a bare specifier from a virtual module is left to Vite', async () => {
  const plugin = await project({
    'app/routes/index.html': "<script server>export default () => ({});</script>\n<p>x</p>\n",
  });
  plugin.load('virtual:transclude-page/index');

  assert.equal(plugin.resolveId('hono', 'virtual:transclude-page/index'), null);
});

test('a relative import from an ordinary file is not this plugin s business', async () => {
  const plugin = await project({ 'app/routes/index.html': '<h1>Home</h1>\n' });

  assert.equal(plugin.resolveId('./notes.js', '/app/lib/index.js'), null);
});
