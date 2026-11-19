#!/usr/bin/env node
// `npm run spec:runtimes`: every case's requests on Node, Bun, Deno and
// workerd, and the answers compared.
//
//   npm run spec:runtimes                      every case
//   npm run spec:runtimes -- fragments         one area
//   npm run spec:runtimes -- --jobs 4          at most four cases at once
//   npm run spec:runtimes -- --runtimes node,bun
//
// `npm run spec` runs first, with the same filters, and builds each case. Then
// each case that built is served on each runtime in turn, from its build
// directory, on one port. Its `expect.json` is replayed over HTTP, the way
// `spec/runner/case.js` replays it in process. Every runtime must answer what
// Node answered: the same status, the same headers and the same bytes.
//
// Writes the run to `spec/report/runtimes.json`. Exits 1 on any difference, and
// when a runtime does not start.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lineDiff } from '../runner/compare.js';
import { replay } from './replay.js';
import { RUNTIMES, serve } from './serve.js';

const specDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportFile = path.join(specDir, 'report', 'runtimes.json');

// Headers a server adds for the connection, not for the app. Each runtime's
// listener writes its own, and none of them is the framework's to decide.
// `content-length` is here because workerd streams with `transfer-encoding`
// instead. The bytes of the body are compared, so the length is too.
const TRANSPORT = new Set(['connection', 'content-length', 'date', 'keep-alive', 'transfer-encoding']);

// The methods every listener hands to the app. Node's HTTP parser answers 400
// to a name it does not know, workerd 501, and Bun closes the connection, all
// before the app sees the request. A case that sends another method is about
// the app, and the in-process run checks it.
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

const { filters, jobs, runtimes } = readArgs(process.argv.slice(2));
const started = performance.now();

const built = buildCases(filters);
const outcomes = await pool(built.cases, jobs, (one, slot) => compareCase(one, 4300 + slot * 2));

const failed = outcomes.filter((outcome) => outcome.problems.length);
for (const outcome of failed) console.log(describe(outcome));

const skipped = built.skipped.length ? `, ${built.skipped.length} not served (${skippedWhy(built.skipped)})` : '';
const leftOff = built.cases.filter((one) => Object.keys(one.notOn).length).length;
const partly = leftOff ? `, ${leftOff} left off a runtime by their runtimes.json` : '';
const seconds = ((performance.now() - started) / 1000).toFixed(1);
console.log(
  `${outcomes.length - failed.length} of ${outcomes.length} cases answer the same on ${runtimes.join(', ')}` +
    `${partly}${skipped}, ${Math.min(jobs, outcomes.length)} at a time, in ${seconds} s`,
);

fs.mkdirSync(path.dirname(reportFile), { recursive: true });
fs.writeFileSync(reportFile, JSON.stringify({ seconds: Number(seconds), runtimes, outcomes, skipped: built.skipped }, null, 2) + '\n');
process.exitCode = failed.length ? 1 : 0;

/** @param {string[]} args */
function readArgs(args) {
  const filters = [];
  let jobs = Math.max(1, Math.floor(os.availableParallelism() / 2));
  let runtimes = Object.keys(RUNTIMES);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--jobs') jobs = Number(args[++i]);
    else if (args[i] === '--runtimes') runtimes = args[++i].split(',');
    else filters.push(args[i]);
  }
  const unknown = runtimes.filter((name) => !RUNTIMES[name]);
  if (unknown.length) throw new Error(`no runtime is named ${unknown.join(', ')}`);
  if (runtimes[0] !== 'node') runtimes = ['node', ...runtimes.filter((name) => name !== 'node')];
  return { filters, jobs, runtimes };
}

/**
 * `npm run spec` with the same filters, which builds every case into
 * `spec/.build`. Its report says which cases built. A case is served when it
 * built and has a request to replay. A case that reads a fake upstream is not:
 * the fake replaces `fetch` inside a Node process, and a server on another
 * runtime has no such hook.
 *
 * @param {string[]} filters
 */
function buildCases(filters) {
  const spec = spawnSync(process.execPath, [path.join(specDir, 'runner', 'index.js'), ...filters], { encoding: 'utf8' });
  const summary = spec.stdout.trim().split('\n').at(-1);
  console.log(`npm run spec: ${summary}`);
  const report = JSON.parse(fs.readFileSync(path.join(specDir, 'report', 'last.json'), 'utf8'));

  const cases = [];
  const skipped = [];
  for (const outcome of report.outcomes) {
    const caseDir = path.join(specDir, 'cases', outcome.id);
    const entries = JSON.parse(fs.readFileSync(path.join(caseDir, 'expect.json'), 'utf8'));
    const requests = entries.filter((entry) => entry.request && METHODS.has(entry.request.split(' ')[0]));
    if (outcome.error || outcome.build?.status !== 0) skipped.push({ id: outcome.id, why: 'no build' });
    else if (!requests.length) skipped.push({ id: outcome.id, why: 'no request' });
    else if (fs.existsSync(path.join(caseDir, 'upstream.json'))) skipped.push({ id: outcome.id, why: 'fake upstream' });
    else cases.push({ id: outcome.id, buildDir: path.join(specDir, '.build', outcome.id), requests, notOn: notOn(caseDir) });
  }
  return { cases, skipped };
}

/**
 * The runtimes a case is not served on, each with the reason, from the case's
 * `runtimes.json`: `{ "workerd": "its data module reads a file with node:fs" }`.
 * A case holds one when what it shows is a runtime's to decide, not the
 * framework's.
 *
 * @param {string} caseDir
 * @returns {Record<string, string>}
 */
function notOn(caseDir) {
  const file = path.join(caseDir, 'runtimes.json');
  if (!fs.existsSync(file)) return {};
  const reasons = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const name of Object.keys(reasons)) {
    if (!RUNTIMES[name] || name === 'node') throw new Error(`${file}: "${name}" is not a runtime a case can leave out`);
  }
  return reasons;
}

/**
 * One case on every runtime, one after another on the same port, so an
 * absolute URL in an answer is the same on each.
 *
 * @param {{ id: string, buildDir: string, requests: object[], notOn: Record<string, string> }} one
 * @param {number} port
 */
async function compareCase({ id, buildDir, requests, notOn }, port) {
  const answered = {};
  const problems = [];
  for (const runtime of runtimes) {
    if (notOn[runtime]) continue;
    try {
      answered[runtime] = await serve(runtime, buildDir, port, () => replay(port, requests));
    } catch (error) {
      problems.push(`${runtime}: ${error.message.split('\n')[0]}`);
    }
  }
  const baseline = answered.node;
  for (const runtime of runtimes.slice(1)) {
    if (!baseline || !answered[runtime]) continue;
    problems.push(...differ(baseline, answered[runtime], runtime));
  }
  return { id, problems, answered: summarize(answered) };
}

/**
 * What one runtime answered that Node did not, request by request.
 *
 * @param {import('./replay.js').Answer[]} want Node's answers
 * @param {import('./replay.js').Answer[]} got
 * @param {string} runtime
 */
function differ(want, got, runtime) {
  const found = [];
  want.forEach((expected, i) => {
    const actual = got[i];
    const where = `${runtime}, ${expected.request}`;
    if (!actual) return found.push(`${where}: no answer`);
    if (actual.status !== expected.status) found.push(`${where}: status ${actual.status}, Node ${expected.status}`);
    const one = headersOf(expected);
    const two = headersOf(actual);
    for (const name of new Set([...Object.keys(one), ...Object.keys(two)])) {
      if (one[name] !== two[name]) found.push(`${where}: header ${name} ${JSON.stringify(two[name])}, Node ${JSON.stringify(one[name])}`);
    }
    if (!actual.body.equals(expected.body)) {
      found.push(`${where}: the body differs from Node's\n${lineDiff(expected.body.toString('utf8'), actual.body.toString('utf8'))}`);
    }
  });
  return found;
}

/**
 * The headers the app wrote, lowercased, one string per name. `set-cookie`
 * keeps each line, in order.
 *
 * @param {import('./replay.js').Answer} answer
 */
function headersOf(answer) {
  const out = {};
  for (const [name, value] of answer.headers) {
    if (TRANSPORT.has(name)) continue;
    const kept = name === 'content-type' ? mediaType(value) : value;
    out[name] = name in out ? `${out[name]}\n${kept}` : kept;
  }
  return out;
}

/**
 * A media type as one spelling. Each runtime's default writes its own:
 * `text/plain; charset=UTF-8` on Node, `text/plain;charset=UTF-8` elsewhere,
 * and Bun's `Response.json()` adds `;charset=utf-8` to `application/json`. Case
 * and the space after `;` mean nothing, and JSON is UTF-8 by definition, so
 * that parameter means nothing either.
 *
 * @param {string} value
 */
function mediaType(value) {
  const spelled = value.toLowerCase().replace(/\s*;\s*/g, ';');
  return spelled === 'application/json;charset=utf-8' ? 'application/json' : spelled;
}

/** The report keeps statuses and headers, not bodies. */
function summarize(answered) {
  const out = {};
  for (const [runtime, answers] of Object.entries(answered)) {
    out[runtime] = answers.map(({ request, status, headers }) => ({ request, status, headers: headersOf({ headers }) }));
  }
  return out;
}

/** @param {{ id: string, problems: string[] }} outcome */
function describe({ id, problems }) {
  const lines = problems.flatMap((problem) => problem.split('\n')).map((line) => `  ${line}`);
  return [`✗ ${id}`, ...lines].join('\n');
}

/** @param {{ why: string }[]} skipped */
function skippedWhy(skipped) {
  const counts = new Map();
  for (const { why } of skipped) counts.set(why, (counts.get(why) ?? 0) + 1);
  return [...counts].map(([why, n]) => `${n} ${why}`).join(', ');
}

/**
 * At most `size` at once. `work` is told which slot it runs in, so each slot
 * can keep a port of its own.
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} size
 * @param {(item: T, slot: number) => Promise<R>} work
 */
async function pool(items, size, work) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async (slot) => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index], slot);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, (_, slot) => worker(slot)));
  return results;
}
