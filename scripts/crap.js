#!/usr/bin/env node
// CRAP per function over `src/`: complexity against the tests that hold it down.
//
//   CRAP = cc^2 * (1 - coverage)^3 + cc
//
// The cube is the point. A function at full coverage scores its own complexity
// and nothing more, so branchy code that is exercised stays cheap and the score
// only climbs where nothing runs the branches. 30 is crap4j's threshold and the
// one used here.
//
// Runs the suite itself rather than reading a report somebody remembered to
// make. Node writes one lcov block per test process, so the blocks are merged
// before anything is measured: reading the first one alone reports a file as
// untested because some other process is what ran it.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import * as acorn from 'acorn';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const THRESHOLD = 30;

function usage() {
  return [
    'Usage: node scripts/crap.js [--json <file>] [--fail-over <n>] [--lcov <file>] [--top <n>]',
    '',
    '  Scores every function in src/ and prints the ones worth looking at.',
    '',
    '  --json <file>    write every function as JSON, for a report',
    '  --fail-over <n>  exit non-zero if any function scores above n',
    '  --lcov <file>    read this coverage instead of running the suite',
    '  --top <n>        how many rows to print (default 15)',
    '',
  ].join('\n');
}

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at === -1 ? null : args[at + 1];
};
if (args.includes('--help')) {
  process.stdout.write(usage());
  process.exit(0);
}

// ---- coverage --------------------------------------------------------------

/** Runs the suite with coverage and hands back the lcov it wrote. */
function measure() {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'crap-')), 'lcov.info');
  const result = spawnSync(
    process.execPath,
    [
      '--test',
      '--experimental-test-coverage',
      '--test-reporter=lcov',
      `--test-reporter-destination=${out}`,
      '--test-reporter=dot',
      '--test-reporter-destination=/dev/null',
      'test/**/*.test.js',
    ],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'ignore', 'inherit'] },
  );
  if (result.status !== 0) {
    process.stderr.write('\nThe suite failed. A score against a red suite says nothing.\n');
    process.exit(result.status ?? 1);
  }
  return out;
}

/**
 * Every line lcov knows about, by file, with the hits summed across blocks.
 *
 * A file loaded by four test processes gets four blocks, each holding only what
 * that process ran. Summing is what makes the total mean anything.
 */
function readCoverage(file) {
  const byFile = new Map();
  let current = null;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line.startsWith('SF:')) {
      current = line.slice(3).trim();
      if (!byFile.has(current)) byFile.set(current, new Map());
    } else if (line.startsWith('DA:') && current) {
      const [at, hits] = line.slice(3).split(',').map(Number);
      const lines = byFile.get(current);
      lines.set(at, (lines.get(at) ?? 0) + hits);
    } else if (line.startsWith('end_of_record')) {
      current = null;
    }
  }
  return byFile;
}

// ---- complexity ------------------------------------------------------------

const FUNCTIONS = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);

const DECISIONS = new Set([
  'IfStatement',
  'ConditionalExpression',
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
  'CatchClause',
]);

/** Child nodes, skipping the keys acorn uses for positions. */
function children(node) {
  const found = [];
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'range') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) if (child && typeof child.type === 'string') found.push(child);
    } else if (value && typeof value.type === 'string') {
      found.push(value);
    }
  }
  return found;
}

/**
 * McCabe over one function's own body.
 *
 * A nested function is scored separately and does not count here. Folding it in
 * would give a 200-line module of small callbacks one enormous number and say
 * nothing about which part of it to test.
 */
function complexity(fn) {
  let score = 1;
  const walk = (node, isRoot) => {
    if (!isRoot && FUNCTIONS.has(node.type)) return;
    if (DECISIONS.has(node.type)) score += 1;
    if (node.type === 'SwitchCase' && node.test) score += 1;
    if (node.type === 'LogicalExpression' && ['&&', '||', '??'].includes(node.operator)) score += 1;
    for (const child of children(node)) walk(child, false);
  };
  walk(fn, true);
  return score;
}

/** What to call a function that may have been written without a name. */
function nameOf(node, parent) {
  if (node.id?.name) return node.id.name;
  if (parent?.type === 'VariableDeclarator' && parent.id?.name) return parent.id.name;
  if (parent?.type === 'Property') return String(parent.key?.name ?? parent.key?.value ?? '?');
  if (parent?.type === 'MethodDefinition') return String(parent.key?.name ?? parent.key?.value ?? '?');
  if (parent?.type === 'PropertyDefinition' && parent.key?.name) return parent.key.name;
  if (parent?.type === 'AssignmentExpression' && parent.left?.type === 'MemberExpression') {
    return `${parent.left.object?.name ?? '?'}.${parent.left.property?.name ?? '?'}`;
  }
  if (parent?.type === 'ExportDefaultDeclaration') return 'default';
  if (parent?.type === 'CallExpression') return `<callback@${node.loc.start.line}>`;
  return `<anon@${node.loc.start.line}>`;
}

// ---- the report ------------------------------------------------------------

function sources() {
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith('.js')) found.push(file);
    }
  };
  walk(path.join(root, 'src'));
  return found.sort();
}

function score(coverage) {
  const rows = [];
  for (const file of sources()) {
    const rel = path.relative(root, file);
    const source = fs.readFileSync(file, 'utf8');
    const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
    const lines = coverage.get(rel) ?? new Map();

    const found = [];
    const seek = (node, parent) => {
      if (FUNCTIONS.has(node.type)) found.push({ node, parent });
      for (const child of children(node)) seek(child, node);
    };
    seek(ast, null);

    for (const { node, parent } of found) {
      const cc = complexity(node);
      const from = node.loc.start.line;
      const to = node.loc.end.line;
      let total = 0;
      let hit = 0;
      for (const [at, hits] of lines) {
        if (at < from || at > to) continue;
        total += 1;
        if (hits > 0) hit += 1;
      }
      // No executable line means nothing to cover, which is not a hole.
      const covered = total === 0 ? 1 : hit / total;
      rows.push({
        file: rel,
        name: nameOf(node, parent),
        line: from,
        cc,
        coverage: covered,
        lines: total,
        hit,
        crap: Math.round((cc * cc * (1 - covered) ** 3 + cc) * 100) / 100,
      });
    }
  }
  rows.sort((a, b) => b.crap - a.crap || b.cc - a.cc);
  return rows;
}

const lcov = flag('--lcov') ?? measure();
const rows = score(readCoverage(lcov));

const json = flag('--json');
if (json) fs.writeFileSync(json, JSON.stringify(rows, null, 1));

const mean = rows.reduce((sum, row) => sum + row.crap, 0) / rows.length;
const totalLines = rows.reduce((sum, row) => sum + row.lines, 0);
const totalHit = rows.reduce((sum, row) => sum + row.hit, 0);
const over = rows.filter((row) => row.crap > THRESHOLD);

const top = Number(flag('--top') ?? 15);
const pad = (value, width) => String(value).padStart(width);

process.stdout.write(
  [
    '',
    `${rows.length} functions in ${sources().length} files`,
    `mean CRAP ${mean.toFixed(2)}   lines in function bodies covered ${((100 * totalHit) / totalLines).toFixed(1)}%   over ${THRESHOLD}: ${over.length}`,
    '',
    '   CRAP   cc   cov  where',
    ...rows.slice(0, top).map(
      (row) =>
        `${pad(row.crap.toFixed(2), 7)} ${pad(row.cc, 4)} ${pad((100 * row.coverage).toFixed(0) + '%', 5)}  ${row.file}:${row.line} ${row.name}`,
    ),
    '',
  ].join('\n'),
);

const failOver = flag('--fail-over');
if (failOver) {
  const bad = rows.filter((row) => row.crap > Number(failOver));
  if (bad.length) {
    process.stderr.write(`\n${bad.length} functions score above ${failOver}.\n`);
    process.exit(1);
  }
}
