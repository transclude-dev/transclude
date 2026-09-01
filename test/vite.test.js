// `vite` is an optional peer, so it can be absent, and what an author sees when
// it is absent is the whole reason `src/vite.js` exists.
//
// The second test copies the module somewhere with no `node_modules` above it.
// Node resolves a bare specifier from the importing file upward, so a copy in a
// temporary directory cannot reach this repository's tree and `import('vite')`
// fails there exactly the way it fails in an install that left vite out.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadVite } from '../src/vite.js';

const root = path.resolve(import.meta.dirname, '..');

test('vite is loaded when it is installed', async () => {
  const vite = await loadVite();
  assert.equal(typeof vite.build, 'function');
  assert.equal(typeof vite.createServer, 'function');
});

test('a missing vite is an error that says what to install', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'transclude-novite-'));
  try {
    const copy = path.join(dir, 'vite.js');
    fs.copyFileSync(path.join(root, 'src/vite.js'), copy);
    const away = await import(pathToFileURL(copy).href);

    await assert.rejects(
      away.loadVite(),
      (err) => {
        assert.match(err.message, /needs vite/);
        assert.match(err.message, /npm install -D vite/);
        // Not the raw resolver error, which names a file inside this package
        // and tells the author nothing they can act on.
        assert.doesNotMatch(err.message, /ERR_MODULE_NOT_FOUND/);
        return true;
      },
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
