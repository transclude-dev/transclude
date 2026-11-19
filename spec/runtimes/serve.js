// A built case, served on one runtime until its requests are answered.
//
// The start, the poll and the cleanup are `scripts/smoke.sh`'s: start the
// server from the app's directory, ask until it answers, and stop it however
// the run ends, so a server that answers wrong does not keep the port.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bin = (name) => path.join(packageRoot, 'bin', name);

// How long a server may take to answer its first request. workerd through
// wrangler takes seconds, and a loaded machine takes more.
const START_MS = 60_000;

/**
 * The command for each runtime, run in the case's build directory with `PORT`
 * set. workerd is run through wrangler, which runs the real workerd.
 *
 * @type {Record<string, (port: number) => string[]>}
 */
export const RUNTIMES = {
  node: () => [process.execPath, bin('serve.js')],
  bun: () => ['bun', bin('serve.bun.js')],
  deno: () => ['deno', 'run', '-A', bin('serve.deno.js')],
  workerd: (port) => [
    'npx',
    '--yes',
    'wrangler',
    'dev',
    '--port',
    String(port),
    '--ip',
    '127.0.0.1',
    // Each slot runs its own wrangler, and two on the default inspector port
    // collide.
    '--inspector-port',
    String(port + 1),
    '--show-interactive-dev-session=false',
  ],
};

/**
 * @template T
 * @param {string} runtime
 * @param {string} buildDir
 * @param {number} port
 * @param {() => Promise<T>} work what to do once the server answers
 * @returns {Promise<T>}
 */
export async function serve(runtime, buildDir, port, work) {
  if (runtime === 'workerd') writeWorker(buildDir);
  const [command, ...args] = RUNTIMES[runtime](port);
  const output = [];
  // Its own process group, so stopping wrangler stops the workerd it started.
  const server = spawn(command, args, {
    cwd: buildDir,
    env: { ...process.env, PORT: String(port), WRANGLER_SEND_METRICS: 'false' },
    detached: true,
  });
  server.stdout.on('data', (chunk) => output.push(chunk));
  server.stderr.on('data', (chunk) => output.push(chunk));
  const exited = new Promise((resolve) => server.on('exit', resolve));
  try {
    await answering(port, exited, () => Buffer.concat(output).toString('utf8'));
    return await work();
  } finally {
    await stop(server, exited);
  }
}

/**
 * Waits until the port takes a connection. Not until `GET /` answers: a case
 * may be about a page that fails, and its first answer is the replay's to
 * read. A server that exits first has failed, and what it printed says why.
 */
async function answering(port, exited, printed) {
  let gone = false;
  exited.then(() => (gone = true));
  const until = Date.now() + START_MS;
  while (Date.now() < until) {
    if (gone) throw new Error(`the server exited before it listened\n${printed()}`);
    if (await listening(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`nothing listened in ${START_MS / 1000} s\n${printed()}`);
}

/** @param {number} port */
function listening(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
  });
}

async function stop(server, exited) {
  if (server.exitCode !== null) return;
  process.kill(-server.pid, 'SIGTERM');
  const timeout = setTimeout(() => process.kill(-server.pid, 'SIGKILL'), 5_000);
  await exited;
  clearTimeout(timeout);
}

/**
 * The worker entry and the wrangler config, the way an app holds them. Both
 * are the app's own files, and a case has neither, so the runner writes the
 * smallest pair every example uses.
 *
 * @param {string} buildDir
 */
function writeWorker(buildDir) {
  fs.writeFileSync(
    path.join(buildDir, 'worker.js'),
    `import { workerFrom } from '@transclude/core/worker';
import * as bundle from './dist/server/assets.js';
import * as entry from './dist/server/entry.js';
import manifest from './dist/routes.json';
import config from './transclude.config.js';

export default workerFrom({ config, manifest, entry, bundle });
`,
  );
  // There is no JSON module type, so the manifest arrives as text and the
  // adapter parses it.
  const wrangler = {
    name: 'spec-case',
    main: 'worker.js',
    compatibility_date: '2026-01-01',
    rules: [{ type: 'Text', globs: ['**/routes.json'], fallthrough: true }],
  };
  fs.writeFileSync(path.join(buildDir, 'wrangler.jsonc'), JSON.stringify(wrangler, null, 2) + '\n');
}
