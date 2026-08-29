#!/usr/bin/env node
// What the browser checks actually reach in the runtime.
//
// `scripts/browser.js` answers whether the checks pass. It cannot answer how
// much of the runtime they run, and that is the question the shadow half turns
// on: the element class, the re-render and the boundary work only in a browser,
// so `npm test` reports `src/runtime/index.js` at 43% and the number means
// nothing. Sixty-one checks were the whole of what anybody knew.
//
// This drives the same page through the DevTools protocol and reads V8's own
// precise coverage back. Against the dev server, not the build: dev serves the
// runtime as its own unminified module, so an offset is a line in a file
// somebody can open. A production bundle would report percentages of minified
// code with the names gone.
//
// No dependencies. `WebSocket` is a global in Node 22, and the protocol is
// JSON over one socket.
//
//   npm run test:coverage            the runtime
//   npm run test:coverage -- --all   every module the page loaded

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const port = Number(process.env.PORT ?? 1973);
const debugPort = Number(process.env.CDP_PORT ?? 9333);
const origin = `http://127.0.0.1:${port}`;
const all = process.argv.includes('--all');

const candidates = [
  process.env.CHROME,
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const running = [];
process.on('exit', () => {
  for (const child of running) child.kill();
});
process.on('SIGINT', () => process.exit(1));

/** Polls until `read` returns something, or the time is up. */
async function until(read, ms, what) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const found = await read().catch(() => null);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`[coverage] gave up after ${ms / 1000}s waiting for ${what}`);
}

// ---- the dev server ---------------------------------------------------------

const server = spawn('npm', ['run', 'dev'], {
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'ignore', 'inherit'],
});
running.push(server);

await until(() => fetch(`${origin}/check`).then((res) => res.ok), 60_000, 'the dev server');

// ---- the browser ------------------------------------------------------------

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'transclude-coverage-'));

async function launch() {
  for (const binary of candidates) {
    // `about:blank`, so coverage is running before the page is. Navigating on
    // the command line would load and execute the runtime before the profiler
    // was told to watch, and every module would report zero.
    const attempt = spawn(binary, [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${debugPort}`,
      'about:blank',
    ]);
    const opened = await new Promise((resolve) => {
      attempt.once('error', () => resolve(false));
      attempt.once('spawn', () => resolve(true));
    });
    if (opened) return attempt;
  }
  return null;
}

const browser = await launch();
if (!browser) {
  console.error(`[coverage] no Chrome found. Tried: ${candidates.join(', ')}. Set CHROME.`);
  process.exit(1);
}
running.push(browser);

// ---- the protocol -----------------------------------------------------------

const target = await until(
  async () => {
    const list = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((res) => res.json());
    return list.find((one) => one.type === 'page')?.webSocketDebuggerUrl;
  },
  30_000,
  'a page to attach to',
);

const socket = new WebSocket(target);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let nextId = 1;
const waiting = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  const settle = waiting.get(message.id);
  if (!settle) return;
  waiting.delete(message.id);
  if (message.error) settle.reject(new Error(message.error.message));
  else settle.resolve(message.result);
});

/** One protocol call, awaited. */
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    waiting.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });

await send('Profiler.enable');
await send('Profiler.startPreciseCoverage', { callCount: false, detailed: true });
await send('Page.enable');
await send('Page.navigate', { url: `${origin}/check?report` });

const report = await until(
  () => fetch(`${origin}/api/checks`).then((res) => (res.status === 200 ? res.json() : null)),
  120_000,
  'a report from the page',
);

const { result } = await send('Profiler.takePreciseCoverage');
socket.close();

// ---- the numbers ------------------------------------------------------------

/**
 * Bytes V8 says ran, per script.
 *
 * A function's ranges arrive outermost first, so writing them in order lets an
 * inner `count: 0` punch a hole in the covered body around it. That is what
 * block coverage is, and reading it any other way counts an untaken branch as
 * taken.
 */
function coveredBytes(entry) {
  let size = 0;
  for (const fn of entry.functions) {
    for (const range of fn.ranges) size = Math.max(size, range.endOffset);
  }

  const hit = new Uint8Array(size);
  for (const fn of entry.functions) {
    for (const range of fn.ranges) {
      hit.fill(range.count > 0 ? 1 : 0, range.startOffset, range.endOffset);
    }
  }
  return { hit, size };
}

/** The lines no byte of which ran, given the source those offsets index. */
function uncoveredLines(source, hit) {
  const cold = [];
  let line = 1;
  let start = 0;

  for (let i = 0; i <= source.length; i++) {
    if (i !== source.length && source[i] !== '\n') continue;

    const text = source.slice(start, i);
    // A blank line and a line of punctuation are not evidence of anything.
    if (text.trim().length > 1) {
      let ran = false;
      for (let at = start; at < i; at++) if (hit[at]) { ran = true; break; }
      if (!ran) cold.push(line);
    }
    line++;
    start = i + 1;
  }
  return cold;
}

/** `[3, 4, 5, 9]` as `3-5 9`. */
function ranges(lines) {
  const out = [];
  for (let i = 0; i < lines.length; ) {
    let j = i;
    while (j + 1 < lines.length && lines[j + 1] === lines[j] + 1) j++;
    out.push(i === j ? `${lines[i]}` : `${lines[i]}-${lines[j]}`);
    i = j + 1;
  }
  return out;
}

const interesting = result.filter((entry) => {
  if (!entry.url.startsWith('http')) return false;
  return all ? entry.url.includes(origin) : /runtime\/index\.js/.test(entry.url);
});

if (!interesting.length) {
  console.error('[coverage] the page loaded no module matching the filter.');
  console.error(`  urls seen: ${result.filter((e) => e.url.startsWith('http')).length}`);
  process.exit(1);
}

console.log(`\n[coverage] ${report.passed}/${report.total} checks, ${report.agent}\n`);

let worst = 0;
for (const entry of interesting) {
  const { hit, size } = coveredBytes(entry);
  if (!size) continue;

  const source = await fetch(entry.url).then((res) => res.text());
  let covered = 0;
  for (const byte of hit) covered += byte;

  const percent = (100 * covered) / size;
  worst = Math.max(worst, 100 - percent);

  const name = entry.url.replace(origin, '').replace(/\?.*$/, '');
  console.log(`  ${percent.toFixed(1).padStart(5)}%  ${name}`);

  if (!all && source.length >= size) {
    // The text, not only the numbers. The dev server transforms a module before
    // it serves it, so an offset indexes what the browser ran and the line it
    // falls on is not always that line in the file. Printing the source makes
    // the output answer for itself, which a number cannot.
    const cold = uncoveredLines(source, hit);
    const lines = source.split('\n');

    if (cold.length) {
      console.log(`\n  ${cold.length} lines no check reaches:\n`);
      for (const group of ranges(cold)) {
        const first = Number(group.split('-')[0]);
        console.log(`    ${group.padEnd(11)} ${(lines[first - 1] ?? '').trim().slice(0, 86)}`);
      }
      console.log('');
    }
  }
}

const good = !report.crash && report.total > 0 && report.passed === report.total;
if (!good) console.log('\n[coverage] the checks did not all pass, so the numbers describe a broken run.');
process.exit(good ? 0 : 1);
