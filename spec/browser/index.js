#!/usr/bin/env node
// `npm run spec:browser`: the cases only a browser can answer, in Chrome.
//
//   npm run spec:browser                    every case that needs Chrome
//   npm run spec:browser -- elements        one area
//   npm run spec:browser -- --snapshot      write the DOM files a case lacks
//
// `npm run spec` runs first, with the same filters, and builds each case.
// Each case that built is served on Node, the way `npm start` serves it, and
// opened in headless Chrome. Two kinds of check run there:
//
// - Every case that defines an element: each page its `expect.json` asks for
//   with a 200 loads with no error, and the body after the elements connect
//   is the body the server sent. Connecting changes nothing a reader sees.
// - A case's `browser.json`: load a URL, run steps, expect values and DOM.
//
// Writes the run to `spec/report/browser.json`. Exits 1 when a check fails.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse, serialize } from 'parse5';
import { lineDiff, normalize } from '../runner/compare.js';
import { ask } from '../runtimes/replay.js';
import { serve } from '../runtimes/serve.js';
import { launchChrome, openTab } from './chrome.js';

const specDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportFile = path.join(specDir, 'report', 'browser.json');

// The body of the element in the page, its shadow roots written out as
// declarative ones, the way the server writes them.
const SERIALIZE = `(selector) => {
  const roots = [];
  const collect = (node) => {
    for (const el of node.querySelectorAll('*')) {
      if (!el.shadowRoot) continue;
      roots.push(el.shadowRoot);
      collect(el.shadowRoot);
    }
  };
  collect(document);
  const el = document.querySelector(selector);
  if (!el) return null;
  return el.getHTML({ shadowRoots: roots });
}`;

const { filters, jobs, snapshot } = readArgs(process.argv.slice(2));
const started = performance.now();

const cases = buildCases(filters);
const chrome = await launchChrome(9340);
let outcomes;
try {
  outcomes = await pool(cases, jobs, (one, slot) => runCase(one, 4500 + slot * 2));
} finally {
  chrome.close();
}

const failed = outcomes.filter((outcome) => outcome.problems.length);
for (const outcome of failed) console.log(describe(outcome));
const seconds = ((performance.now() - started) / 1000).toFixed(1);
const checks = outcomes.reduce((sum, outcome) => sum + outcome.checks, 0);
console.log(`${outcomes.length - failed.length} of ${outcomes.length} cases pass in Chrome, ${checks} checks, in ${seconds} s`);

fs.mkdirSync(path.dirname(reportFile), { recursive: true });
fs.writeFileSync(reportFile, JSON.stringify({ seconds: Number(seconds), outcomes }, null, 2) + '\n');
process.exitCode = failed.length ? 1 : 0;

/** @param {string[]} args */
function readArgs(args) {
  const filters = [];
  let jobs = Math.max(1, Math.min(4, os.availableParallelism()));
  let snapshot = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--jobs') jobs = Number(args[++i]);
    else if (args[i] === '--snapshot') snapshot = true;
    else filters.push(args[i]);
  }
  return { filters, jobs, snapshot };
}

/**
 * `npm run spec`, then every case that built and either defines an element or
 * holds a `browser.json`. A case that reads a fake upstream is left out, as in
 * `spec/runtimes/`: the fake lives inside the spec's own process.
 *
 * @param {string[]} filters
 */
function buildCases(filters) {
  // The package's budgets are `npm run spec`'s own job, and the build budget
  // needs `www` installed, which this job does not do.
  const args = [path.join(specDir, 'runner', 'index.js'), '--no-package-budgets', ...filters];
  const spec = spawnSync(process.execPath, args, { encoding: 'utf8' });
  const summary = spec.stdout.trim().split('\n').at(-1) ?? '';
  // A run that matched nothing writes no report, and the last one would be read
  // in its place, with builds from before whatever changed since.
  if (!/ cases pass/.test(summary)) throw new Error(`npm run spec did not run: ${spec.stderr.trim() || summary}`);
  // A case that fails there is left out here. Its blocks are printed, so the
  // log says which and why.
  if (spec.status !== 0) console.log(spec.stdout.trim().split('\n').slice(0, -1).join('\n'));
  console.log(`npm run spec: ${summary}`);
  const report = JSON.parse(fs.readFileSync(path.join(specDir, 'report', 'last.json'), 'utf8'));

  const cases = [];
  for (const outcome of report.outcomes) {
    // The package's budgets sit in the report as an outcome of their own.
    if (outcome.id === 'budgets') continue;
    if (outcome.error || outcome.build?.status !== 0) continue;
    const caseDir = path.join(specDir, 'cases', outcome.id);
    if (fs.existsSync(path.join(caseDir, 'upstream.json'))) continue;
    const buildDir = path.join(specDir, '.build', outcome.id);
    const browserFile = path.join(caseDir, 'browser.json');
    const entries = fs.existsSync(browserFile) ? JSON.parse(fs.readFileSync(browserFile, 'utf8')) : [];
    const elements = definesElements(buildDir);
    if (!elements && !entries.length) continue;
    cases.push({ id: outcome.id, caseDir, buildDir, elements, entries, pages: elements ? pagesOf(caseDir) : [] });
  }
  return cases;
}

/** Whether the case's elements directories hold an element. */
function definesElements(buildDir) {
  const file = path.join(buildDir, 'transclude.config.js');
  const source = fs.readFileSync(file, 'utf8');
  // Read, not imported: a config may import what only the build has. The two
  // keys that place the directories are plain strings in every case here.
  const appDir = source.match(/appDir:\s*'([^']+)'/)?.[1] ?? 'app';
  const elementsDirs = [...(source.match(/elementsDir:\s*(\[[^\]]*\]|'[^']+')/)?.[1].matchAll(/'([^']+)'/g) ?? [])].map((m) => m[1]);
  const dirs = elementsDirs.length ? elementsDirs : ['elements'];
  return dirs.some((dir) => {
    const full = path.join(buildDir, appDir, dir);
    return fs.existsSync(full) && fs.readdirSync(full).some((name) => name.endsWith('.html'));
  });
}

/**
 * Each page the case's `expect.json` asks for with a GET and answers with a
 * 200 and markup, once. A request that sends anything is left out: it is
 * about the request, and a browser loading the URL would not send it.
 *
 * @param {string} caseDir
 */
function pagesOf(caseDir) {
  const entries = JSON.parse(fs.readFileSync(path.join(caseDir, 'expect.json'), 'utf8'));
  const urls = entries
    .filter((entry) => entry.request?.startsWith('GET ') && entry.status === 200 && !entry.send)
    .filter((entry) => !entry.body || entry.body.endsWith('.html'))
    .map((entry) => entry.request.slice(4))
    .filter((url) => !url.includes('[hash]'));
  return [...new Set(urls)];
}

/**
 * One case: served on Node, and each check in a tab of its own.
 *
 * @param {{ id: string, caseDir: string, buildDir: string, entries: any[], pages: string[] }} one
 * @param {number} port
 */
async function runCase({ id, caseDir, buildDir, entries, pages }, port) {
  const origin = `http://127.0.0.1:${port}`;
  const problems = [];
  let checks = 0;
  try {
    await serve('node', buildDir, port, async () => {
      for (const url of pages) {
        const found = await connectChangesNothing(port, origin, url);
        if (found === null) continue;
        checks++;
        problems.push(...found);
      }
      for (const entry of entries) {
        checks++;
        problems.push(...(await runEntry(origin, caseDir, entry)));
      }
    });
  } catch (error) {
    problems.push(`the server: ${error.message.split('\n')[0]}`);
  }
  return { id, checks, problems };
}

/**
 * A page loads with no error, and its body after every element has connected
 * is the body the server sent. `null` for an answer that is not a document,
 * such as an icon sprite: there is no body to connect.
 */
async function connectChangesNothing(port, origin, url) {
  const sent = await ask(port, url, { method: 'GET', headers: new Headers() });
  if (!/^\s*<!doctype/i.test(sent.body.toString('utf8'))) return null;
  const tab = await openTab(chrome);
  try {
    await tab.load(origin + url);
    const problems = tab.errors.map((error) => `GET ${url}: ${error}`);
    const connected = await tab.evaluate(`(${SERIALIZE})('body')`);
    const want = normalize(bodyOf(sent.body.toString('utf8')));
    const got = normalize(connected ?? '');
    if (want !== got) problems.push(`GET ${url}: connecting changed the body\n${lineDiff(want, got)}`);
    return problems;
  } finally {
    await tab.close();
  }
}

/** The inside of a document's `<body>`, as markup. */
function bodyOf(html) {
  const document = parse(html);
  const root = document.childNodes.find((node) => node.tagName === 'html');
  const body = root?.childNodes.find((node) => node.tagName === 'body');
  return body ? serialize(body) : '';
}

/**
 * One entry of a `browser.json`, in a fresh tab:
 *
 *   { "name": "…", "load": "/", "steps": [
 *       { "run": "document.querySelector('x-a').setAttribute('n', '2')" },
 *       { "expect": "document.querySelector('x-a').n", "equals": 2 },
 *       { "dom": "x-a", "file": "expected/after.html" } ] }
 *
 * A `run` is awaited, then the page settles: two frames and a task. Any
 * exception or `console.error` in the page fails the entry.
 */
async function runEntry(origin, caseDir, entry) {
  const where = entry.name ?? entry.load;
  const tab = await openTab(chrome);
  const problems = [];
  try {
    await tab.load(origin + entry.load);
    for (const step of entry.steps ?? []) {
      const found = await runStep(tab, caseDir, step);
      if (found) {
        problems.push(`${where}: ${found}`);
        break;
      }
    }
    problems.push(...tab.errors.map((error) => `${where}: ${error}`));
  } catch (error) {
    problems.push(`${where}: ${error.message}`);
  } finally {
    await tab.close();
  }
  return problems;
}

/** A step, or what was wrong with it. */
async function runStep(tab, caseDir, step) {
  if (step.run !== undefined) {
    await tab.evaluate(step.run);
    await tab.settle();
    return null;
  }
  if (step.expect !== undefined) {
    const got = await tab.evaluate(step.expect);
    if (JSON.stringify(got) === JSON.stringify(step.equals)) return null;
    return `${step.expect}: expected ${JSON.stringify(step.equals)}, got ${JSON.stringify(got)}`;
  }
  if (step.dom !== undefined) {
    const got = await tab.evaluate(`(${SERIALIZE})(${JSON.stringify(step.dom)})`);
    if (got === null) return `no element matches ${step.dom}`;
    const file = path.join(caseDir, step.file);
    if (!fs.existsSync(file)) {
      if (!snapshot) return `${step.file} is missing. Run with --snapshot to write it from what Chrome holds`;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, got + '\n');
      return null;
    }
    // Trimmed, because a file ends with a newline and an element's inside need not.
    const want = normalize(fs.readFileSync(file, 'utf8')).trim();
    const held = normalize(got).trim();
    if (want === held) return null;
    return `${step.dom} differs from ${step.file}\n${lineDiff(want, held)}`;
  }
  return `a step needs run, expect or dom: ${JSON.stringify(step)}`;
}

/** @param {{ id: string, problems: string[] }} outcome */
function describe({ id, problems }) {
  const lines = problems.flatMap((problem) => problem.split('\n')).map((line) => `  ${line}`);
  return [`✗ ${id}`, ...lines].join('\n');
}

/**
 * At most `size` at once, each told its slot, so each slot keeps a port.
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
