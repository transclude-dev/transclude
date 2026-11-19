// Limits that are tests: `spec/budgets.json`.
//
// Each limit sits a little above what the code measured when it was set, the
// way the coverage floor sits under today's coverage. Ordinary drift stays
// under it, and a real loss goes over. A result carries what was measured, so
// the report shows how close each one is.
//
// Two kinds. A case's own budgets run in its process, after its invariants:
// the client JavaScript it builds, and how long named requests take to render.
// The package's run once, at the end of a full `npm run spec`: its packed size
// and how long `www` takes to build.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const specDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = path.resolve(specDir, '..');

// Renders before the clock starts, so a module's first load is not counted,
// and renders timed. The median of an odd count is one of them.
const WARM = 20;
const TIMED = 101;

/** @returns {{ clientBytes: Record<string, number>, renderMs: Record<string, Record<string, number>>, packedBytes: number, wwwBuildSeconds: number }} */
function budgets() {
  return JSON.parse(fs.readFileSync(path.join(specDir, 'budgets.json'), 'utf8'));
}

/**
 * A case's budgets. Client JavaScript is every `.js` file the build wrote to
 * `dist/client`, in bytes as built. A case the file does not name has a
 * budget of 0, so a case that starts shipping JavaScript says so.
 *
 * @param {{ id: string, buildDir: string, app: { request: (url: string, init?: RequestInit) => Promise<Response> } }} one
 */
export async function caseBudgets({ id, buildDir, app }) {
  const limits = budgets();
  const results = [];

  const bytes = clientBytes(path.join(buildDir, 'dist', 'client'));
  const allowed = limits.clientBytes[id] ?? 0;
  const over = bytes > allowed ? [`client JavaScript is ${bytes} bytes, over the budget of ${allowed}`] : [];
  results.push({ request: 'budget: client JavaScript', measured: bytes, limit: allowed, problems: over });

  for (const [request, ms] of Object.entries(limits.renderMs[id] ?? {})) {
    const [method, url] = request.split(' ');
    const median = await medianMs(() => app.request(`http://localhost${url}`, { method }).then((res) => res.text()));
    const slow = median > ms ? [`${request} takes ${median.toFixed(3)} ms, the median of ${TIMED}, over the budget of ${ms}`] : [];
    results.push({ request: `budget: render ${request}`, measured: Number(median.toFixed(3)), limit: ms, problems: slow });
  }
  return results;
}

/** The package's budgets, as results of one outcome named `budgets`. */
export function packageBudgets() {
  const limits = budgets();
  const results = [];

  const packed = packedBytes();
  const big = packed > limits.packedBytes ? [`the package packs to ${packed} bytes, over the budget of ${limits.packedBytes}`] : [];
  results.push({ request: 'budget: packed size', measured: packed, limit: limits.packedBytes, problems: big });

  const seconds = wwwBuildSeconds();
  const slow =
    seconds === null
      ? ['www has no node_modules, so its build was not timed. Run `npm ci --prefix www`']
      : seconds > limits.wwwBuildSeconds
        ? [`www builds in ${seconds.toFixed(1)} s, over the budget of ${limits.wwwBuildSeconds}`]
        : [];
  results.push({ request: 'budget: www build', measured: seconds === null ? null : Number(seconds.toFixed(1)), limit: limits.wwwBuildSeconds, problems: slow });
  return results;
}

/** @param {string} dir */
function clientBytes(dir) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith('.js')) total += fs.statSync(path.join(entry.parentPath, entry.name)).size;
  }
  return total;
}

/** @param {() => Promise<unknown>} render */
async function medianMs(render) {
  for (let i = 0; i < WARM; i++) await render();
  const times = [];
  for (let i = 0; i < TIMED; i++) {
    const start = performance.now();
    await render();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return times[(TIMED - 1) / 2];
}

/** What `npm pack` would publish, compressed, in bytes. */
function packedBytes() {
  const out = spawnSync('npm', ['pack', '--dry-run', '--json'], { cwd: packageRoot, encoding: 'utf8' });
  const [pack] = JSON.parse(out.stdout);
  return pack.size;
}

/** How long `npm run build --prefix www` takes, or null when www is not installed. */
function wwwBuildSeconds() {
  if (!fs.existsSync(path.join(packageRoot, 'www', 'node_modules'))) return null;
  const start = performance.now();
  const out = spawnSync('npm', ['run', 'build', '--prefix', 'www'], { cwd: packageRoot, encoding: 'utf8' });
  if (out.status !== 0) throw new Error(`www did not build:\n${out.stderr}`);
  return (performance.now() - start) / 1000;
}
