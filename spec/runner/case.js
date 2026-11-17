// One case, in a process of its own: copy, build, ask, compare.
//
// A process per case because `@transclude/core/production` finds its app once,
// when it is imported, and keeps it. A second case in the same process would be
// answered by the first case's app.
//
// The parent forks this file with the case directory and the build directory
// as arguments, and reads one message back.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { differences } from './compare.js';

const [caseDir, buildDir] = process.argv.slice(2);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const result = await run();
process.send?.(result);

async function run() {
  const entries = JSON.parse(fs.readFileSync(path.join(caseDir, 'expect.json'), 'utf8'));
  copyApp();
  const build = runBuild();

  const expectsFailure = entries.some((entry) => entry.build === 'fails');
  if (expectsFailure) return { build, results: entries.map((entry) => checkDiagnostic(entry, build)) };
  if (build.status !== 0) return { build, results: [], error: 'the build failed' };

  process.chdir(buildDir);
  const { app } = await import('@transclude/core/production');
  const results = [];
  for (const entry of entries) results.push(await checkRequest(app, entry));
  return { build, results };
}

/**
 * The case's app and config, copied where the build may write `dist/`.
 *
 * Never a `package.json`. The build directory sits inside this package so the
 * built server can import `@transclude/core` by name, which Node resolves by
 * reading the nearest manifest. A manifest in the case would be that one.
 */
function copyApp() {
  fs.rmSync(buildDir, { recursive: true, force: true });
  fs.mkdirSync(buildDir, { recursive: true });
  fs.cpSync(path.join(caseDir, 'app'), path.join(buildDir, 'app'), { recursive: true });

  const config = path.join(caseDir, 'transclude.config.js');
  const target = path.join(buildDir, 'transclude.config.js');
  if (fs.existsSync(config)) fs.copyFileSync(config, target);
  else fs.writeFileSync(target, 'export default {};\n');
}

/** The package's own `transclude-build`, found the way npm finds it: by `bin`. */
function runBuild() {
  const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  const bin = path.join(packageRoot, manifest.bin['transclude-build']);
  const out = spawnSync(process.execPath, [bin], { cwd: buildDir, encoding: 'utf8' });
  return { status: out.status, stderr: relative(out.stderr) };
}

/** Build output with the build directory cut away, so a path reads `app/routes/index.html`. */
function relative(text) {
  return text.split(buildDir + path.sep).join('');
}

/** @param {{ build: string, diagnostic: string }} entry */
function checkDiagnostic(entry, build) {
  const request = 'build';
  const expectedFile = path.join(caseDir, entry.diagnostic);
  if (build.status === 0) return { request, problems: ['the build succeeded, and the case expects it to fail'] };
  if (!fs.existsSync(expectedFile)) return { request, missing: entry.diagnostic, actual: excerpt(build.stderr) };

  const want = fs.readFileSync(expectedFile, 'utf8').trim();
  const problems = [];
  if (!build.stderr.includes(want)) problems.push(`diagnostic: expected the build to print\n${want}\ngot\n${build.stderr.trim()}`);
  return { request, problems };
}

/**
 * The part of a failed build's output that is the diagnostic: from the first
 * line naming a file under `app/` to the first stack frame. The frames name
 * the framework's own files, which a rewrite is free to move.
 *
 * @param {string} stderr
 */
function excerpt(stderr) {
  const lines = stderr.split('\n');
  const first = lines.findIndex((line) => /\bapp\/\S+:\d+/.test(line));
  const from = Math.max(first, 0);
  const frame = lines.findIndex((line, index) => index > from && /^\s+at /.test(line));
  const to = frame === -1 ? lines.length : frame;
  return lines.slice(from, to).join('\n').trim() + '\n';
}

/**
 * What a request sends besides its method and URL. A `form` goes the way a
 * browser posts one: form-encoded, with an `origin` that CSRF accepts.
 * `headers` are applied last, so a case can take either away.
 *
 * @param {string} method
 * @param {{ headers?: Record<string, string>, form?: Record<string, string> }} [send]
 * @returns {RequestInit}
 */
function initFor(method, send = {}) {
  const init = { method, redirect: 'manual', headers: new Headers() };
  if (send.form) {
    init.headers.set('origin', 'http://localhost');
    init.headers.set('content-type', 'application/x-www-form-urlencoded');
    init.body = new URLSearchParams(send.form).toString();
  }
  for (const [name, value] of Object.entries(send.headers ?? {})) init.headers.set(name, value);
  return init;
}

/**
 * @param {{ request: string, send?: object, status?: number,
 *   headers?: Record<string, string>, body?: string }} entry
 */
async function checkRequest(app, entry) {
  const [method, url] = entry.request.split(' ');
  const res = await app.request(`http://localhost${url}`, initFor(method, entry.send));
  const actual = { status: res.status, headers: res.headers, body: await res.text() };

  // In the report on every entry, so a failure and a new case can both be
  // read without running anything again.
  const answered = { status: res.status, headers: Object.fromEntries(res.headers) };

  const bodyFile = entry.body ? path.join(caseDir, entry.body) : null;
  if (bodyFile && !fs.existsSync(bodyFile)) {
    return { request: entry.request, answered, missing: entry.body, actual: actual.body };
  }

  const expected = { status: entry.status, headers: entry.headers, body: undefined };
  if (bodyFile) expected.body = fs.readFileSync(bodyFile, 'utf8');
  return { request: entry.request, answered, problems: differences(expected, actual) };
}
