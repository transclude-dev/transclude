// The Vite plugin, registered once and registered twice.
//
// The bins hand the plugin to Vite themselves. Vite also loads the project's own
// `vite.config.js` and merges the two lists rather than deduping them, so a
// project that registers the plugin as well ends up with two of it. These read a
// real resolved config, because the merge is the thing being checked and nothing
// else models it.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveConfig } from 'vite';

import transclude from '../src/plugin.js';

const SERVER_ENTRY = 'virtual:transclude-server';

/** An app on disk, because `configResolved` scans one. */
function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-plugin-'));
  fs.mkdirSync(path.join(dir, 'app', 'routes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'app', 'routes', 'index.html'), '<h1>hi</h1>\n');
  return dir;
}

/** Resolves a config with these plugins, the way a bin does. */
const resolve = (root, plugins) =>
  resolveConfig({ root, plugins, logLevel: 'silent', publicDir: false, configFile: false }, 'build');

test('one plugin answers for the virtual modules', async () => {
  const root = project();
  const only = transclude({ appDir: 'app' });
  await resolve(root, [only]);

  assert.equal(only.resolveId(SERVER_ENTRY), SERVER_ENTRY);
});

test('a second registration is inert', async () => {
  // Both instances are `enforce: 'pre'` and both would claim every virtual
  // module. Vite takes the first non-null, so the damage is not a wrong answer:
  // it is the app scanned twice and, in dev, a second watcher that reloads the
  // browser again for one edit.
  const root = project();
  const [first, second] = [transclude({ appDir: 'app' }), transclude({ appDir: 'app' })];
  await resolve(root, [first, second]);

  assert.equal(first.resolveId(SERVER_ENTRY), SERVER_ENTRY);
  assert.equal(second.resolveId(SERVER_ENTRY), null, 'the second instance still claimed the entry');
  assert.equal(second.load(SERVER_ENTRY), null, 'the second instance still compiled it');
});

test('nothing shipped registers the plugin itself', async () => {
  // A project may want its own `vite.config.js` for another plugin. What it must
  // not do is add this one, which is what every template used to show. The
  // templates are what a new project copies, so the wrong shape spreads from
  // there.
  // `fileURLToPath`, not `url.pathname`: a space in the path stays encoded there.
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const dirs = [
    ...fs.readdirSync(path.join(root, 'examples')).map((n) => path.join(root, 'examples', n)),
    ...fs.readdirSync(path.join(root, 'create', 'templates')).map((n) =>
      path.join(root, 'create', 'templates', n),
    ),
    path.join(root, 'www'),
  ];

  const wrong = [];
  for (const dir of dirs) {
    const file = path.join(dir, 'vite.config.js');
    if (!fs.existsSync(file)) continue;
    if (/@transclude\/core/.test(fs.readFileSync(file, 'utf8'))) wrong.push(path.basename(dir));
  }

  assert.deepEqual(wrong, [], `these register the plugin a second time: ${wrong.join(', ')}`);
});

// ---- public files in dev ---------------------------------------------------
//
// `dev.js` passes `publicDir: false` to Vite so Hono serves these the same way
// in dev as in production. The cost is that Vite no longer knows they exist, and
// `transformIndexHtml` warms every `<script type="module" src>` it finds, so a
// layout with `<script head src="/theme.js" type="module">` logged "Failed to
// load url /theme.js. Does the file exist?" on every request. Answering with the
// file is what ends that quietly. A warning that is wrong every time gets read
// as decoration, so this is pinned rather than left to be noticed again.

/** An app with a public file, and the plugin resolved the way `dev.js` does. */
async function serving(file = 'theme.js') {
  const root = project();
  fs.mkdirSync(path.join(root, 'app', 'public'), { recursive: true });
  fs.writeFileSync(path.join(root, 'app', 'public', file), 'export default 1\n');

  const plugin = transclude({ appDir: 'app' });
  await resolveConfig(
    { root, plugins: [plugin], logLevel: 'silent', publicDir: false, configFile: false },
    'serve',
  );
  // Vite resolves its root through symlinks, and on macOS `os.tmpdir()` is one:
  // `/var/folders/…` is `/private/var/folders/…`. Comparing against the path
  // `mkdtemp` handed back fails on that alone.
  return { root: fs.realpathSync(root), plugin };
}

test('dev answers for a public file, so Vite stops warning about it', async () => {
  const { root, plugin } = await serving();

  assert.equal(plugin.resolveId('/theme.js'), path.join(root, 'app', 'public', 'theme.js'));
});

test('a public file it does not have is left alone', async () => {
  const { plugin } = await serving();

  assert.equal(plugin.resolveId('/nothing.js'), null);
});

test("Vite's own ids are never answered for", async () => {
  const { plugin } = await serving();

  assert.equal(plugin.resolveId('/@vite/client'), null);
});

test('a URL cannot walk out of the public directory', async () => {
  const { plugin } = await serving();

  // `/public-x` is prefixed by the directory name and is not inside it, and a
  // `..` in a URL must not reach the project either.
  assert.equal(plugin.resolveId('/../transclude.config.js'), null);
  assert.equal(plugin.resolveId('/../../etc/hosts'), null);
});

test('a build answers for nothing, so rolldown does not bundle a public file', async () => {
  const root = project();
  fs.mkdirSync(path.join(root, 'app', 'public'), { recursive: true });
  fs.writeFileSync(path.join(root, 'app', 'public', 'theme.js'), 'export default 1\n');

  const plugin = transclude({ appDir: 'app' });
  await resolve(root, [plugin]);

  // The build copies the directory. Resolving the id here would make the file a
  // module as well, and it would ship twice.
  assert.equal(plugin.resolveId('/theme.js'), null);
});
