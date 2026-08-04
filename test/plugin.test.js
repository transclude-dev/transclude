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

  assert.equal(only.resolveId(SERVER_ENTRY), '\0' + SERVER_ENTRY);
});

test('a second registration is inert', async () => {
  // Both instances are `enforce: 'pre'` and both would claim every virtual
  // module. Vite takes the first non-null, so the damage is not a wrong answer:
  // it is the app scanned twice and, in dev, a second watcher that reloads the
  // browser again for one edit.
  const root = project();
  const [first, second] = [transclude({ appDir: 'app' }), transclude({ appDir: 'app' })];
  await resolve(root, [first, second]);

  assert.equal(first.resolveId(SERVER_ENTRY), '\0' + SERVER_ENTRY);
  assert.equal(second.resolveId(SERVER_ENTRY), null, 'the second instance still claimed the entry');
  assert.equal(second.load('\0' + SERVER_ENTRY), null, 'the second instance still compiled it');
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
