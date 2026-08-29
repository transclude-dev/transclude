#!/usr/bin/env node
// Every refusal the compiler can make, read out of the code that makes it.
//
// "What the compiler refuses" is the one thing still listed as moving before
// 1.0, and the list grows whenever a mistake turns out to be silent. A list
// that grows is a list somebody has to be able to read, and the only honest
// copy is the source: a message written by hand into a docs page is a second
// copy, and the second copy is the one that goes stale.
//
// So this parses the compiler with acorn, which is already a dependency, and
// pulls the fixed words out of every `new CompileError(...)` and
// `new ScriptError(...)`. A message is a template: the fixed parts are the
// sentence, and the holes are whatever the author wrote.
//
//   node scripts/refusals.js          the catalog, as a table
//   node scripts/refusals.js --json   the same, for a test to read

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The installed package, wherever npm put it. Resolving a subpath it exports and
// walking up from that, rather than assuming `node_modules/@transclude/core` is
// a directory here: in this checkout it is a symlink to the repository, and the
// catalog should describe the compiler this site is really built against.
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(require.resolve('@transclude/core/compiler')), '../..');
const REFUSALS = ['CompileError', 'ScriptError'];

/** Every `.js` file under `src/compiler`, which is where refusals live. */
function sources() {
  const dir = path.join(root, 'src/compiler');
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.js'))
    .sort()
    .map((name) => path.join('src/compiler', name));
}

/**
 * The fixed words of a message expression.
 *
 * A template's quasis are the sentence and its expressions are the holes; a
 * `+` chain of strings is the same sentence written another way, and the
 * compiler uses both. A hole becomes `…`, so the reader can see one was there
 * without the catalog claiming to know what goes in it.
 */
function words(node) {
  if (!node) return '';
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral') {
    return node.quasis.map((q, i) => q.value.cooked + (i < node.expressions.length ? '…' : '')).join('');
  }
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    return words(node.left) + words(node.right);
  }
  return '…';
}

/** Walks every node, because a throw can be anywhere. */
function walk(node, visit) {
  if (!node || typeof node.type !== 'string') return;
  visit(node);
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (Array.isArray(value)) for (const child of value) walk(child, visit);
    else if (value && typeof value.type === 'string') walk(value, visit);
  }
}

const found = [];
for (const rel of sources()) {
  const source = fs.readFileSync(path.join(root, rel), 'utf8');
  const tree = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true });

  walk(tree, (node) => {
    if (node.type !== 'NewExpression') return;
    if (!REFUSALS.includes(node.callee?.name)) return;

    const message = words(node.arguments[0]).replace(/\s+/g, ' ').trim();
    if (!message) return;

    // Most messages open by naming the thing refused — a tag, an export, a
    // file — and that is a hole. Leading with `…: ` would sort the catalog by
    // nothing and read like noise, so the name comes off and the sentence
    // starts where the sentence starts.
    const sentence = message.replace(/^…(:\s*|\s+)/, '');

    found.push({
      kind: node.callee.name,
      // The first sentence, which is the refusal. What follows is the advice,
      // and a catalog printing all of it would be the source with worse
      // formatting.
      says: sentence.split(/(?<=\.)\s/)[0],
      full: message,
      where: `${rel}:${node.loc.start.line}`,
    });
  });
}

found.sort((a, b) => a.says.localeCompare(b.says));

const out = path.join(site, 'app/lib/refusals.js');
fs.writeFileSync(
  out,
  `// Written by scripts/refusals-data.js. Do not edit.\n` +
    `//\n` +
    `// Every refusal in the compiler this site is built against, read out of it.\n` +
    `// See the script for why this is a module and not a file a loader reads.\n\n` +
    `export const refusals = ${JSON.stringify(found, null, 2)};\n`,
);
console.log(`wrote app/lib/refusals.js: ${found.length} refusals`);
