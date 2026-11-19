#!/usr/bin/env node
// `npm run spec`: every case, each built and asked in its own process.
//
//   npm run spec                       every case
//   npm run spec -- fragments          one area
//   npm run spec -- fragments/marked-element
//   npm run spec -- --jobs 4           at most four cases at once
//   npm run spec -- --snapshot <id>    write the expected files a case lacks
//   npm run spec -- --no-package-budgets  leave out the packed size and the www build
//
// Prints one block per failing case and a count, and writes the whole run to
// `spec/report/last.json`. Exits 1 when any case fails.

import { fork } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageBudgets } from './budgets.js';

const specDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const casesDir = path.join(specDir, 'cases');
const buildRoot = path.join(specDir, '.build');
const reportFile = path.join(specDir, 'report', 'last.json');

const { filters, jobs, snapshot, packageBudgetsWanted } = readArgs(process.argv.slice(2));
const started = performance.now();

const ids = findCases(casesDir).filter((id) => matches(id, filters));
if (ids.length === 0) {
  console.error(`no case matches ${filters.join(' ')}`);
  process.exit(1);
}

const outcomes = await pool(ids, jobs, runCase);
if (snapshot) writeMissing(outcomes);

// The package's own budgets, on a full run only. They are about the whole
// package, and a run of one area should stay a run of seconds.
const wholeRun = filters.length === 0 && packageBudgetsWanted;
if (wholeRun) outcomes.push({ id: 'budgets', ms: 0, results: packageBudgets() });

const failed = outcomes.filter((outcome) => !passed(outcome));
for (const outcome of failed) console.log(describe(outcome));

const seconds = ((performance.now() - started) / 1000).toFixed(1);
const atOnce = Math.min(jobs, ids.length);
const todos = todosOf(outcomes);
const exempt = exemptOf(outcomes);
const marks = (todos ? `, ${todos} todo` : '') + (exempt ? `, ${exempt} exempt` : '');
const casesFailed = failed.filter((outcome) => outcome.id !== 'budgets').length;
const budgetLine = wholeRun ? (failed.some((outcome) => outcome.id === 'budgets') ? ', package budgets over' : ', package budgets kept') : '';
console.log(`${ids.length - casesFailed} of ${ids.length} cases pass${marks}${budgetLine}, ${atOnce} at a time, in ${seconds} s`);

fs.mkdirSync(path.dirname(reportFile), { recursive: true });
fs.writeFileSync(reportFile, JSON.stringify({ seconds: Number(seconds), jobs, outcomes }, null, 2) + '\n');
process.exitCode = failed.length ? 1 : 0;

/** @param {string[]} args */
function readArgs(args) {
  const filters = [];
  let jobs = os.availableParallelism();
  let snapshot = false;
  let packageBudgetsWanted = true;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--jobs') jobs = Number(args[++i]);
    else if (args[i] === '--snapshot') snapshot = true;
    else if (args[i] === '--no-package-budgets') packageBudgetsWanted = false;
    else filters.push(args[i]);
  }
  return { filters, jobs, snapshot, packageBudgetsWanted };
}

/**
 * Every directory under `cases/` that holds an `expect.json`, as an id such as
 * `fragments/marked-element`. Sorted, so two runs list them the same way.
 *
 * @param {string} dir
 * @returns {string[]}
 */
function findCases(dir) {
  const found = [];
  for (const area of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!area.isDirectory()) continue;
    for (const one of fs.readdirSync(path.join(dir, area.name), { withFileTypes: true })) {
      const id = `${area.name}/${one.name}`;
      if (fs.existsSync(path.join(dir, id, 'expect.json'))) found.push(id);
    }
  }
  return found.sort();
}

/** An id matches a filter equal to it or to its area. No filter matches all. */
function matches(id, filters) {
  if (filters.length === 0) return true;
  const area = id.split('/')[0];
  return filters.some((filter) => filter === id || filter === area);
}

/**
 * Runs `work` over `items`, at most `size` at a time, and keeps their order.
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} size
 * @param {(item: T) => Promise<R>} work
 * @returns {Promise<R[]>}
 */
async function pool(items, size, work) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return results;
}

/**
 * One case in a child process. A child that exits without a message, because
 * an import threw or the process crashed, is a failure with its output kept.
 *
 * @param {string} id
 */
function runCase(id) {
  const caseStarted = performance.now();
  const child = fork(path.join(specDir, 'runner', 'case.js'), [path.join(casesDir, id), path.join(buildRoot, id)], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));

  return new Promise((resolve) => {
    let message = null;
    child.on('message', (received) => (message = received));
    // `close`, not `exit`. A child's last message can still be in the channel
    // when `exit` fires, and the case was then a failure with no output to
    // read: `diagnostics/gated-covers-nothing` failed that way once on CI.
    child.on('close', (code, signal) => {
      const ms = Math.round(performance.now() - caseStarted);
      if (message) resolve({ id, ms, ...message });
      else resolve({ id, ms, results: [], error: `the case process exited without an answer (code ${code}, signal ${signal})\n${output.trim()}` });
    });
  });
}

/** A case passes when it has no error, no problem and no missing expected file. */
function passed(outcome) {
  if (outcome.error) return false;
  return outcome.results.every((result) => resultPasses(result));
}

/**
 * A clean result passes. One marked `todo` passes by failing, because the
 * mark says the gap is known. Once it comes back clean the mark is stale, and
 * that fails until someone takes it off.
 *
 * An invariant a case is `exempt` from is read the same way. The two are kept
 * apart because a `todo` is a gap to close, and an exemption is the case
 * being about the very thing the invariant forbids.
 */
function resultPasses(result) {
  const clean = !result.missing && result.problems.length === 0;
  if (result.todo || result.exempt) return !clean;
  return clean;
}

/** How many entries are marked `todo` and still fail, as they should. */
function todosOf(outcomes) {
  const all = outcomes.flatMap((outcome) => outcome.results);
  return all.filter((result) => result.todo && !resultPasses({ ...result, todo: null })).length;
}

/** How many invariants a case is exempt from and still fail there, as they should. */
function exemptOf(outcomes) {
  const all = outcomes.flatMap((outcome) => outcome.results);
  return all.filter((result) => result.exempt && !resultPasses({ ...result, exempt: null })).length;
}

function describe(outcome) {
  const lines = [`✗ ${outcome.id}`];
  if (outcome.error) lines.push(indent(outcome.error));
  if (outcome.error && outcome.build?.stderr) lines.push(indent(outcome.build.stderr.trim()));
  for (const result of outcome.results) {
    const marked = result.todo || result.exempt;
    if (marked && resultPasses(result)) continue;
    if (result.todo) lines.push(`  ${result.request}: passes now, so its todo is stale: ${result.todo}`);
    if (result.exempt) lines.push(`  ${result.request}: passes now, so the exemption is stale: ${result.exempt}`);
    if (result.missing) lines.push(`  ${result.request}: no ${result.missing} yet (--snapshot writes it)`);
    for (const problem of result.problems ?? []) lines.push(`  ${result.request}\n${indent(problem, 4)}`);
  }
  return lines.join('\n');
}

function indent(text, by = 2) {
  const pad = ' '.repeat(by);
  return text
    .split('\n')
    .map((line) => pad + line)
    .join('\n');
}

/**
 * The expected files a case does not have yet, written from what came back.
 * Only missing ones: an expected file that exists is the contract, and this
 * never overwrites it. A changed answer is a `spec:` commit somebody reviews.
 */
function writeMissing(outcomes) {
  for (const outcome of outcomes) {
    for (const result of outcome.results) {
      if (!result.missing) continue;
      const file = path.join(casesDir, outcome.id, result.missing);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, result.actual);
      console.log(`wrote ${path.relative(specDir, file)}, unreviewed`);
      // Still a failure: an entry with no body file returned before its status
      // and headers were checked, so this run has not checked them.
      result.missing = null;
      result.problems = ['written by --snapshot, so status and headers are unchecked until the next run'];
    }
  }
}
