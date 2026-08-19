#!/usr/bin/env node
// Runs /check in a real browser and exits the way the checks did.
//
// The checks themselves live in app/routes/check.html and only a browser can
// answer them: a shadow boundary, a form counting a custom element as a field,
// moveBefore. This drives them without a driver protocol. The page already
// posts its results to /api/checks when the URL carries ?report, so all this
// has to do is serve the built app, open the URL in headless Chrome, and read
// the report back from the endpoint.
//
// No dependencies. CI has Chrome on the runner image, and a laptop has one at
// a well-known path. Set CHROME to use another binary.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Not 1961: a dev server someone left running would answer the health check
// and the report would describe source, not the build.
const port = Number(process.env.PORT ?? 1971);
const origin = `http://127.0.0.1:${port}`;

if (!fs.existsSync('dist/routes.json')) {
  console.error('[browser] no build to serve. Run `npm run build` first.');
  process.exit(1);
}

const candidates = [
  process.env.CHROME,
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const running = [];
const stop = () => {
  for (const child of running) child.kill();
};
process.on('exit', stop);
process.on('SIGINT', () => process.exit(1));

/** Polls until `read` returns something, or the time is up. */
async function until(read, ms, what) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const found = await read().catch(() => null);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`[browser] gave up after ${ms / 1000}s waiting for ${what}`);
}

// ---- the server -------------------------------------------------------------

const server = spawn('npm', ['start'], {
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'ignore', 'inherit'],
});
running.push(server);

await until(() => fetch(`${origin}/check`).then((res) => res.ok), 30_000, 'the server');

// ---- the browser ------------------------------------------------------------

// A fresh profile in a temporary directory, or a Chrome already open on the
// machine swallows the launch and this script drives nothing.
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'transclude-check-'));

// A missing binary errors on spawn; the first one that launches is the browser.
async function launch() {
  for (const binary of candidates) {
    const attempt = spawn(binary, [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      `--user-data-dir=${profile}`,
      `${origin}/check?report`,
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
  console.error(`[browser] no Chrome found. Tried: ${candidates.join(', ')}. Set CHROME.`);
  process.exit(1);
}
running.push(browser);

// ---- the report ---------------------------------------------------------------

const report = await until(
  () => fetch(`${origin}/api/checks`).then((res) => (res.status === 200 ? res.json() : null)),
  90_000,
  'a report from the page',
);

const good = !report.crash && report.total > 0 && report.passed === report.total;
console.log(`[browser] ${good ? 'ok' : 'FAIL'}  ${report.passed}/${report.total}  ${report.agent}`);
if (report.crash) console.log(`  crashed: ${report.crash}`);
for (const one of report.failed) console.log(`  x ${one.name}\n    ${one.why}`);

process.exit(good ? 0 : 1);
