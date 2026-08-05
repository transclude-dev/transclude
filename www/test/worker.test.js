// This site is a Cloudflare Worker, so everything a loader imports ends up in a
// bundle workerd loads.
//
// Written after a deploy failed with `No such module "node:fs"`. A loader had
// imported it to read the version out of a manifest, which is an ordinary thing
// to write and works everywhere else this app runs: `npm run dev`, `npm start`
// and `npm run build` are all Node. The build passed, every test passed, and the
// only thing that said no was Cloudflare's API, after the merge.
//
// `wrangler deploy --dry-run` does not catch it either. Measured.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = path.join(root, 'dist/server/entry.js');

// Reads what `npm run build` wrote, which is not run for us. CI builds before it
// tests, so this is a real assertion there.
const describe = fs.existsSync(bundle) ? test : test.skip;

/**
 * Every `node:` module a file really imports.
 *
 * Parsed rather than searched. Two pages here document `import fs from
 * 'node:fs'` inside a code sample, and a sample is text in a template literal.
 * A regular expression counts those, which is how the first version of this
 * test failed against a bundle that was fine.
 */
function nodeImports(file) {
  const tree = parse(fs.readFileSync(file, 'utf8'), {
    ecmaVersion: 'latest',
    sourceType: 'module',
  });

  const found = [];
  for (const node of tree.body) {
    const from =
      node.type === 'ImportDeclaration' ||
      node.type === 'ExportNamedDeclaration' ||
      node.type === 'ExportAllDeclaration'
        ? node.source?.value
        : null;

    if (typeof from === 'string' && from.startsWith('node:')) found.push(from);
  }
  return [...new Set(found)].sort();
}

describe('nothing the worker loads imports a node: module', () => {
  const files = ['dist/server/entry.js', 'dist/server/assets.js', 'worker.js']
    .map((rel) => path.join(root, rel))
    .filter((file) => fs.existsSync(file));

  assert.ok(files.length >= 2, 'the build wrote less than this expects');

  for (const file of files) {
    const imports = nodeImports(file);
    assert.deepEqual(
      imports,
      [],
      `${path.relative(root, file)} imports ${imports.join(', ')}, which workerd has none of`,
    );
  }
});
