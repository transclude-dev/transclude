// One case, in a process of its own: copy, build, ask, compare.
//
// A process per case because `@transclude/core/production` finds its app once,
// when it is imported, and keeps it. A second case in the same process would be
// answered by the first case's app.
//
// The parent forks this file with the case directory and the build directory
// as arguments, and reads one message back.

import { spawnSync } from 'node:child_process';
import { format } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createClient } from './client.js';
import { differences } from './compare.js';
import { checkInvariants } from './invariants.js';

const [caseDir, buildDir] = process.argv.slice(2);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// What a case holds about itself, as opposed to the app it describes.
const NOT_THE_APP = new Set(['CASE.md', 'expect.json', 'expected', 'invariants.json', 'property.js', 'runtimes.json', 'upstream.json', 'upstream']);

// A case that reads another site carries a fake one. Both the build and this
// process are given it, through `SPEC_UPSTREAM`, before any app code runs.
const upstreamFile = path.join(caseDir, 'upstream.json');
const upstreamModule = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), 'upstream.js')).href;
if (fs.existsSync(upstreamFile)) process.env.SPEC_UPSTREAM = upstreamFile;

// What the app prints to `console.error` and `console.warn` while one request
// is answered. Kept rather than printed, so an entry can hold what the server
// was supposed to say.
let heard = [];

// Cookies, the bodies sent so far and the last ETag, kept between entries.
const client = createClient();

// Every request the entries made, as it went, with what came back. The
// invariants read these once the entries are done, and ask some of them again.
const exchanges = [];

const result = await run();
process.send?.(result);

async function run() {
  const entries = JSON.parse(fs.readFileSync(path.join(caseDir, 'expect.json'), 'utf8'));
  copyApp();
  const build = runBuild();

  const expectsFailure = entries.some((entry) => entry.build === 'fails');
  if (expectsFailure) return { build, results: entries.map((entry) => marked(entry, checkDiagnostic(entry, build))) };
  if (build.status !== 0) return { build, results: [], error: 'the build failed' };

  process.chdir(buildDir);
  await import(upstreamModule);
  for (const level of ['error', 'warn']) console[level] = (...args) => heard.push(format(...args));
  const { app } = await import('@transclude/core/production');
  const results = [];
  for (const entry of entries) {
    const result = entry.build === 'warns' ? checkWarning(entry, build) : await checkEntry(app, entry);
    results.push(marked(entry, result));
  }
  const ask = (method, url, init) => askAgain(app, method, url, init);
  results.push(...(await checkInvariants({ caseDir, buildDir, exchanges, ask })));
  return { build, results };
}

/**
 * A request for an invariant. It goes as it went the first time, cookies
 * included, and keeps nothing: the jar, the answers and the ETag stay as the
 * entries left them.
 */
async function askAgain(app, method, url, init) {
  const res = await app.request(`http://localhost${url}`, { ...init, method, headers: new Headers(init.headers) });
  return { status: res.status, headers: res.headers, body: await res.text() };
}

/**
 * A result with its entry's `todo` note, if it has one. A `todo` entry
 * records a known gap: the parent lets it fail, and fails it once it passes.
 */
function marked(entry, result) {
  return { ...result, todo: entry.todo ?? null };
}

/**
 * The case's app, copied where the build may write `dist/`. Everything but the
 * case's own files, so a directory beside `app/`, such as a second
 * `elementsDir`, comes along.
 *
 * Never a `package.json`. The build directory sits inside this package so the
 * built server can import `@transclude/core` by name, which Node resolves by
 * reading the nearest manifest. A manifest in the case would be that one.
 */
function copyApp() {
  fs.rmSync(buildDir, { recursive: true, force: true });
  fs.mkdirSync(buildDir, { recursive: true });
  for (const name of fs.readdirSync(caseDir)) {
    if (NOT_THE_APP.has(name)) continue;
    if (name === 'package.json') throw new Error('a case may not hold a package.json');
    fs.cpSync(path.join(caseDir, name), path.join(buildDir, name), { recursive: true });
  }

  // No config is the default config.
  const target = path.join(buildDir, 'transclude.config.js');
  if (!fs.existsSync(target)) fs.writeFileSync(target, 'export default {};\n');
}

/** The package's own `transclude-build`, found the way npm finds it: by `bin`. */
function runBuild() {
  const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  const bin = path.join(packageRoot, manifest.bin['transclude-build']);
  const args = process.env.SPEC_UPSTREAM ? ['--import', upstreamModule, bin] : [bin];
  const out = spawnSync(process.execPath, args, { cwd: buildDir, encoding: 'utf8' });
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
 * A build that succeeds and says something on the way. The warnings are the
 * lines the framework prints with `[transclude]` in front, and they must be
 * the expected file, all of them. Exact, so a case can show that a warning
 * stays quiet.
 *
 * @param {{ build: string, diagnostic: string }} entry
 */
function checkWarning(entry, build) {
  const request = 'build';
  const expectedFile = path.join(caseDir, entry.diagnostic);
  const warnings = build.stderr
    .split('\n')
    .filter((line) => line.startsWith('[transclude] '))
    .join('\n');
  if (!fs.existsSync(expectedFile)) return { request, missing: entry.diagnostic, actual: warnings + '\n' };

  const want = fs.readFileSync(expectedFile, 'utf8').trim();
  const problems = [];
  if (warnings.trim() !== want) problems.push(`warning: expected the build to print\n${want}\ngot\n${warnings || '(no warning)'}`);
  return { request, problems };
}

/**
 * The part of a failed build's output that is the diagnostic: from the first
 * line `startsDiagnostic` accepts to the first stack frame. The frames name
 * the framework's own files, which a rewrite is free to move.
 *
 * @param {string} stderr
 */
function excerpt(stderr) {
  const lines = stderr.split('\n');
  const first = lines.findIndex((line) => startsDiagnostic(line));
  const from = Math.max(first, 0);
  // `at app/routes/index.html:1` is the build naming the author's line, not a
  // stack frame, so it stays.
  const frame = lines.findIndex((line, index) => index > from && /^\s+at (?!app\/)/.test(line));
  const to = frame === -1 ? lines.length : frame;
  return lines.slice(from, to).join('\n').trim() + '\n';
}

/**
 * A log up to its first stack frame. The frames name the framework's own
 * files, which a rewrite is free to move, and carry this machine's paths.
 *
 * @param {string} log
 */
function withoutFrames(log) {
  const lines = log.split('\n');
  const frame = lines.findIndex((line) => /^\s+at (?!app\/)/.test(line));
  const kept = frame === -1 ? lines : lines.slice(0, frame);
  return kept.join('\n').trim() + '\n';
}

/**
 * A line a diagnostic can start on: the prerender's `N pages failed to
 * render:`, one naming a file under `app/`, the bundler's `[plugin …]` line, or
 * the error itself. Lines before it are the build's own, and one of them
 * carries a time that changes every run.
 *
 * @param {string} line
 */
function startsDiagnostic(line) {
  if (/^\d+ pages? failed to render:$/.test(line)) return true;
  if (/\bapp\/\S+:\d+/.test(line)) return true;
  if (line.startsWith('[plugin ')) return true;
  return /^\w*Error: /.test(line);
}

/**
 * @param {{ request: string, send?: object, status?: number,
 *   headers?: Record<string, string>, body?: string }} entry
 */
async function checkEntry(app, entry) {
  const asked = entry.request ? await checkRequest(app, entry) : { request: 'upstream', problems: [] };
  if (entry.upstream) asked.problems = [...(asked.problems ?? []), ...readsDiffer(entry.upstream)];
  return asked;
}

/**
 * How the fake upstream's read counts differ from what an entry expects. The
 * counts are for this process only: what the build read is not in them.
 *
 * @param {Record<string, number>} expected
 */
function readsDiffer(expected) {
  const { reads } = globalThis[Symbol.for('spec.upstream')];
  const found = [];
  for (const [url, count] of Object.entries(expected)) {
    const got = reads.get(url) ?? 0;
    if (got !== count) found.push(`upstream reads of ${url}: expected ${count}, got ${got}`);
  }
  return found;
}

async function checkRequest(app, entry) {
  const [method, written] = entry.request.split(' ');
  const url = client.assetUrl(written);
  if (url === null) return { request: entry.request, problems: [`no earlier answer in this case names ${written}`] };

  heard = [];
  const init = client.initFor(method, entry.send);
  const res = await app.request(`http://localhost${url}`, init);
  const actual = { status: res.status, headers: res.headers, body: await res.text() };
  client.remember(res.headers, actual.body);
  exchanges.push({ method, url, init, ...actual });
  const log = relative(heard.join('\n'));

  // In the report on every entry, so a failure and a new case can both be
  // read without running anything again.
  const answered = { status: res.status, headers: Object.fromEntries(res.headers) };

  const bodyFile = entry.body ? path.join(caseDir, entry.body) : null;
  if (bodyFile && !fs.existsSync(bodyFile)) {
    return { request: entry.request, answered, missing: entry.body, actual: actual.body };
  }

  const expected = { status: entry.status, headers: entry.headers, body: undefined, exact: false };
  if (bodyFile) expected.body = fs.readFileSync(bodyFile, 'utf8');
  // Only HTML goes through parse5. A sitemap or a plain-text answer has no
  // insignificant whitespace, and the HTML parser would read it loosely.
  expected.exact = Boolean(bodyFile) && !bodyFile.endsWith('.html');
  const problems = differences(expected, actual);

  if (!entry.log) return { request: entry.request, answered, problems };
  const logFile = path.join(caseDir, entry.log);
  if (!fs.existsSync(logFile)) return { request: entry.request, answered, missing: entry.log, actual: withoutFrames(log) };
  const want = fs.readFileSync(logFile, 'utf8').trim();
  if (!log.includes(want)) problems.push(`log: expected the server to print\n${want}\ngot\n${log.trim() || '(nothing)'}`);
  return { request: entry.request, answered, problems };
}
