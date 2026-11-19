// Headless Chrome, driven over the DevTools protocol.
//
// The way `examples/showcase/scripts/coverage.js` drives it: no dependency,
// Node's own `WebSocket`, and JSON over one socket per tab. Written again here
// rather than imported, because nothing in the package reaches into
// `examples/`.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CANDIDATES = [
  process.env.CHROME,
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

/**
 * One Chrome for the whole run, with a fresh profile, so a Chrome already open
 * on the machine does not swallow the launch.
 *
 * @param {number} debugPort
 */
export async function launchChrome(debugPort) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'transclude-spec-'));
  for (const binary of CANDIDATES) {
    const chrome = spawn(binary, [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${debugPort}`,
      'about:blank',
    ]);
    const opened = await new Promise((resolve) => {
      chrome.once('error', () => resolve(false));
      chrome.once('spawn', () => resolve(true));
    });
    if (!opened) continue;
    await until(() => fetch(`http://127.0.0.1:${debugPort}/json/version`).then((res) => res.ok), 30_000, 'Chrome');
    return { debugPort, close: () => chrome.kill() };
  }
  throw new Error(`no Chrome found. Tried: ${CANDIDATES.join(', ')}. Set CHROME.`);
}

/**
 * A new tab, with what the page says kept: each uncaught exception, each
 * `console.error` and each failed load, such as a script that 404s.
 *
 * @param {{ debugPort: number }} chrome
 */
export async function openTab({ debugPort }) {
  const target = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' }).then((res) => res.json());
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  let nextId = 1;
  const waiting = new Map();
  const errors = [];
  let loaded = null;
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(exceptionText(message.params.exceptionDetails));
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      errors.push(`console.error: ${message.params.args.map((arg) => arg.value ?? arg.description).join(' ')}`);
    }
    // Chrome asks for `/favicon.ico` on its own, and no case names one.
    const entry = message.method === 'Log.entryAdded' ? message.params.entry : null;
    if (entry?.level === 'error' && !entry.url?.endsWith('/favicon.ico')) {
      errors.push(`${entry.text} ${entry.url ?? ''}`.trim());
    }
    if (message.method === 'Page.loadEventFired') loaded?.();
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

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');

  return {
    errors,

    /** Navigates, and waits for the load event and a frame after it. */
    async load(url) {
      const done = new Promise((resolve) => (loaded = resolve));
      await send('Page.navigate', { url });
      await done;
      await this.settle();
    },

    /**
     * An expression's value, awaited when it is a promise. A throw is an
     * error with the page's own message.
     *
     * @param {string} expression
     */
    async evaluate(expression) {
      const { result, exceptionDetails } = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (exceptionDetails) throw new Error(exceptionText(exceptionDetails));
      return result.value;
    },

    /**
     * Two frames and a task. A re-render waits for a microtask and a style for
     * a frame, so this is after both.
     */
    settle() {
      return this.evaluate(
        'new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done))))',
      );
    },

    async close() {
      socket.close();
      await fetch(`http://127.0.0.1:${debugPort}/json/close/${target.id}`);
    },
  };
}

/** @param {any} details */
function exceptionText(details) {
  return details.exception?.description ?? details.text;
}

/** Polls until `read` returns something truthy, or the time is up. */
async function until(read, ms, what) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const found = await read().catch(() => null);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`gave up after ${ms / 1000} s waiting for ${what}`);
}
