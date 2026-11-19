#!/usr/bin/env node
// Which small changes to a module the spec does not notice.
//
//   node scripts/mutate.js src/document.js
//   node scripts/mutate.js src/document.js routing forms   only those areas of the spec
//   node scripts/mutate.js src/document.js --only 12-40    mutations 12 to 40, of the list
//
// Walks the module with acorn, the way `scripts/crap.js` walks `src/`, and
// makes one change at a time: a comparison or a logical operator flipped, a
// condition negated, a statement dropped, a string changed, a boolean flipped.
// For each, it runs `npm run spec` with the areas given, and a mutation that
// leaves every case passing survives. A survivor is a missing case or a dead
// branch, and each is printed with its line.
//
// The file is written back after every run, and on Ctrl-C. Writes the whole
// run to `spec/report/mutations.json`.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as acorn from 'acorn';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const reportFile = path.join(root, 'spec', 'report', 'mutations.json');

// One spec run per mutation. A mutation that loops forever is caught by this,
// and counts as caught.
const RUN_MS = 180_000;

const FLIPPED = {
  '===': '!==', '!==': '===', '==': '!=', '!=': '==',
  '<': '>=', '>=': '<', '>': '<=', '<=': '>',
  '&&': '||', '||': '&&', '??': '&&',
  '+': '-', '-': '+',
};

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const [target, ...areas] = args.filter((arg, i) => arg !== '--only' && args[i - 1] !== '--only');
if (!target) {
  console.error('usage: node scripts/mutate.js <module> [area …] [--only <from>-<to>]');
  process.exit(1);
}

const file = path.resolve(root, target);
const original = fs.readFileSync(file, 'utf8');
const restore = () => fs.writeFileSync(file, original);
process.on('SIGINT', () => {
  restore();
  process.exit(130);
});

const all = mutationsOf(original);
const [from, to] = only ? only.split('-').map(Number) : [1, all.length];
const chosen = all.slice(from - 1, to);
console.log(`${all.length} mutations in ${target}; running ${chosen.length}, ${areas.length ? areas.join(' ') : 'every case'}`);

const results = [];
try {
  for (const [i, mutation] of chosen.entries()) {
    fs.writeFileSync(file, original.slice(0, mutation.start) + mutation.text + original.slice(mutation.end));
    const caught = specFails();
    restore();
    results.push({ ...mutation, caught });
    const mark = caught ? '.' : 'S';
    process.stdout.write(mark);
    if ((i + 1) % 50 === 0) process.stdout.write(` ${i + 1}\n`);
  }
} finally {
  restore();
}

const survivors = results.filter((result) => !result.caught);
console.log(`\n\n${results.length - survivors.length} of ${results.length} caught, ${survivors.length} survived\n`);
for (const one of survivors) console.log(`  ${target}:${one.line}  ${one.kind}: ${one.was} → ${one.text}`);

fs.mkdirSync(path.dirname(reportFile), { recursive: true });
fs.writeFileSync(reportFile, JSON.stringify({ target, areas, results }, null, 2) + '\n');

/** Whether `npm run spec` fails with the file as it is now. */
function specFails() {
  const run = spawnSync(process.execPath, ['spec/runner/index.js', '--no-package-budgets', ...areas], {
    cwd: root,
    encoding: 'utf8',
    timeout: RUN_MS,
  });
  return run.status !== 0;
}

/**
 * Every change this script makes, in source order, each as the text that
 * replaces `start` to `end`.
 *
 * @param {string} source
 */
function mutationsOf(source) {
  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  const found = [];
  const add = (node, kind, text, start = node.start, end = node.end) =>
    found.push({ kind, start, end, line: node.loc.start.line, was: source.slice(start, end).split('\n')[0].slice(0, 60), text });

  walk(ast, null, (node, parent) => {
    if ((node.type === 'BinaryExpression' || node.type === 'LogicalExpression') && FLIPPED[node.operator]) {
      // The operator sits between the two sides, and is the first match of it
      // after the left one ends.
      const at = source.indexOf(node.operator, node.left.end);
      add(node, 'operator', FLIPPED[node.operator], at, at + node.operator.length);
    }
    if ((node.type === 'IfStatement' || node.type === 'ConditionalExpression') && node.test) {
      add(node.test, 'negated', `!(${source.slice(node.test.start, node.test.end)})`, node.test.start, node.test.end);
    }
    if (node.type === 'ExpressionStatement' && parent?.type === 'BlockStatement') {
      add(node, 'dropped', ';');
    }
    if (node.type === 'Literal' && typeof node.value === 'string' && changeable(node, parent)) {
      add(node, 'string', JSON.stringify(`${node.value}~`));
    }
    if (node.type === 'Literal' && typeof node.value === 'boolean') {
      add(node, 'boolean', String(!node.value));
    }
  });
  return found.sort((a, b) => a.start - b.start);
}

/** A string that is data, not an import path, a key or a directive. */
function changeable(node, parent) {
  if (!parent) return false;
  if (parent.type === 'ImportDeclaration' || parent.type === 'ExportNamedDeclaration' || parent.type === 'ExportAllDeclaration') return false;
  if (parent.type === 'ImportExpression') return false;
  if (parent.type === 'Property' && parent.key === node) return false;
  if (parent.type === 'ExpressionStatement' && parent.directive) return false;
  return true;
}

/** Every node, each with its parent. */
function walk(node, parent, visit) {
  if (!node || typeof node.type !== 'string') return;
  visit(node, parent);
  for (const key of Object.keys(node)) {
    if (key === 'loc') continue;
    const value = node[key];
    if (Array.isArray(value)) for (const child of value) walk(child, node, visit);
    else if (value && typeof value.type === 'string') walk(value, node, visit);
  }
}
