// Starting a project.
//
// These run the bin the way a person does and read what lands. What is in
// `templates/` is what a new project is, so the assertions are about the files
// rather than about the code that copies them.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const create = path.join(root, 'bin', 'create.js');

/** Runs the bin into a fresh directory and hands back that directory. */
const make = (args, fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'transclude-create-'));
  const target = path.join(dir, 'app-name');
  try {
    execFileSync('node', [create, target, ...args, '--yes'], { encoding: 'utf8' });
    return fn(target);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');

test('the blank template is one page and the files to serve it', () => {
  make(['--template', 'blank'], (dir) => {
    const files = fs.readdirSync(path.join(dir, 'app', 'routes'));
    assert.deepEqual(files, ['index.html']);

    const page = read(dir, 'app/routes/index.html');
    assert.match(page, /<h1>/);
    assert.doesNotMatch(page, /<script server>/, 'the blank page has a loader');
  });
});

test('the minimal template has a layout, a second page and a 404', () => {
  make(['--template', 'minimal'], (dir) => {
    const files = fs.readdirSync(path.join(dir, 'app', 'routes')).sort();
    assert.deepEqual(files, ['404.html', '_layout.html', 'about.html', 'index.html']);
  });
});

test('neither template ships the demo of things a starter should not decide', () => {
  // Fragments, includes and elements are what the showcase is for. A project
  // starts without an opinion about them.
  for (const template of ['blank', 'minimal']) {
    make(['--template', template], (dir) => {
      const all = fs
        .readdirSync(path.join(dir, 'app', 'routes'))
        .map((name) => read(dir, `app/routes/${name}`))
        .join('\n');

      assert.doesNotMatch(all, /<transclude/, `${template} includes something`);
      assert.doesNotMatch(all, /\bfragment\b/, `${template} declares a region`);
    });
  }
});

test('the directory name becomes the package name and the heading', () => {
  make(['--template', 'blank'], (dir) => {
    assert.equal(JSON.parse(read(dir, 'package.json')).name, 'app-name');
    assert.match(read(dir, 'app/routes/index.html'), /<h1>app-name<\/h1>/);
    assert.doesNotMatch(read(dir, 'package.json'), /__NAME__|__TRANSCLUDE__/);
  });
});

test('it depends on a published version, not on wherever this checkout is', () => {
  make(['--template', 'blank'], (dir) => {
    const { dependencies } = JSON.parse(read(dir, 'package.json'));
    assert.match(dependencies.transclude, /^\^\d+\.\d+\.\d+$/);
  });
});

test('--link points at the checkout instead, which is how the framework is worked on', () => {
  make(['--template', 'blank', '--link'], (dir) => {
    const { dependencies } = JSON.parse(read(dir, 'package.json'));
    assert.equal(dependencies.transclude, `file:${root}`);
  });
});

test('the ignore file arrives named so tools read it', () => {
  // `.gitignore` inside `templates/` would be applied to the template itself by
  // everything that reads one, npm included, so it is stored as `_gitignore`.
  make(['--template', 'blank'], (dir) => {
    assert.ok(fs.existsSync(path.join(dir, '.gitignore')));
    assert.ok(!fs.existsSync(path.join(dir, '_gitignore')));
    assert.match(read(dir, '.gitignore'), /node_modules/);
  });
});

test('a directory with something in it is refused rather than merged', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'transclude-create-'));
  fs.writeFileSync(path.join(dir, 'mine.txt'), 'do not lose me');

  try {
    assert.throws(
      () => execFileSync('node', [create, dir, '--yes'], { encoding: 'utf8', stdio: 'pipe' }),
      /is not empty/,
    );
    assert.equal(fs.readFileSync(path.join(dir, 'mine.txt'), 'utf8'), 'do not lose me');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a template nobody has says so, and names the ones there are', () => {
  assert.throws(
    () => execFileSync('node', [create, 'x', '-t', 'nope', '--yes'], { stdio: 'pipe' }),
    /no template called "nope".*minimal, blank/s,
  );
});

test('every template builds a project that type-checks', () => {
  // The templates carry `__NAME__` in places tsc reads, so a placeholder left in
  // the wrong file is a syntax error nobody would see until a person ran it.
  for (const template of ['blank', 'minimal']) {
    make(['--template', template], (dir) => {
      for (const rel of ['package.json', 'jsconfig.json']) {
        assert.doesNotThrow(() => JSON.parse(read(dir, rel)), `${template}/${rel}`);
      }
      assert.doesNotMatch(read(dir, 'transclude.config.js'), /__[A-Z]+__/);
    });
  }
});
