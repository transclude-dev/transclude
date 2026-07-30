// Where the app is, and what it configured.
//
// The root comes from the working directory and the config is loaded from there
// at run time, so nothing in the package names a path in the app.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { CONFIG_FILE, findRoot, loadProject } from '../src/project.js';

/** A project on disk, because that is the only thing `loadProject` reads. */
function project(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-project-'));
  fs.writeFileSync(path.join(dir, CONFIG_FILE), `export default ${config};\n`);
  return dir;
}

test('the root is the nearest directory holding the config', () => {
  const dir = project("{ appDir: 'app' }");
  const deep = path.join(dir, 'a', 'b');
  fs.mkdirSync(deep, { recursive: true });

  assert.equal(fs.realpathSync(findRoot(deep)), fs.realpathSync(dir));
});

test('no config anywhere above is an error naming the file', () => {
  assert.throws(() => findRoot(path.parse(process.cwd()).root), new RegExp(CONFIG_FILE));
});

test('a config that is not an object is refused', async () => {
  const dir = project('42');
  await assert.rejects(() => loadProject(dir), /must export a config object/);
});

test('an ordinary config loads', async () => {
  const dir = project("{ appDir: 'app', elementsDir: 'elements' }");
  const { config } = await loadProject(dir);
  assert.equal(config.elementsDir, 'elements');
});

// ---- the shape this replaced ----------------------------------------------

for (const key of ['partialsDir', 'componentsDir']) {
  test(`\`${key}\` is refused, rather than being ignored`, async () => {
    // Nothing reads either one now. Left alone the app would look in
    // `app/elements/`, find nothing, and render every tag as an unmatched
    // custom element with no styles and no error.
    const dir = project(`{ appDir: 'app', ${key}: 'x' }`);

    await assert.rejects(() => loadProject(dir), new RegExp(key));
    await assert.rejects(() => loadProject(dir), /elementsDir/);
    await assert.rejects(() => loadProject(dir), /export const shadow = true/);
  });
}

test('both old keys are named at once, not one at a time', async () => {
  const dir = project("{ partialsDir: 'p', componentsDir: 'c' }");
  await assert.rejects(() => loadProject(dir), /partialsDir and componentsDir/);
});
