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
import { differences } from './compare.js';

const [caseDir, buildDir] = process.argv.slice(2);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// What a case holds about itself, as opposed to the app it describes.
const NOT_THE_APP = new Set(['CASE.md', 'expect.json', 'expected', 'upstream.json', 'upstream']);

// A case that reads another site carries a fake one. Both the build and this
// process are given it, through `SPEC_UPSTREAM`, before any app code runs.
const upstreamFile = path.join(caseDir, 'upstream.json');
const upstreamModule = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), 'upstream.js')).href;
if (fs.existsSync(upstreamFile)) process.env.SPEC_UPSTREAM = upstreamFile;

// The cookies earlier answers in this case set, by name, the way a browser
// keeps them. Every request sends them back.
const jar = new Map();

// What the app prints to `console.error` and `console.warn` while one request
// is answered. Kept rather than printed, so an entry can hold what the server
// was supposed to say.
let heard = [];

// Every body this case has been sent, in order. A request for a built asset
// names it with `[hash]`, and the name is read back from these, the way a
// browser follows a link the page gave it.
const answers = [];

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
  return { build, results };
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
 * What a request sends besides its method and URL. A `form` goes the way a
 * browser posts one: form-encoded, with an `origin` that CSRF accepts. The jar
 * goes as `cookie`. `headers` are applied last, so a case can replace any of
 * these, a forged or an empty cookie included.
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
  // Bytes, not a string: `Request` gives a string body `text/plain` on its
  // own, and a case may be about a body with no content type at all.
  if (send.body !== undefined) init.body = new TextEncoder().encode(send.body);
  if (jar.size) init.headers.set('cookie', [...jar].map(([name, value]) => `${name}=${value}`).join('; '));
  for (const [name, value] of Object.entries(send.headers ?? {})) {
    // `null` takes a header away, so a case can send a form with no origin.
    if (value === null) init.headers.delete(name);
    else init.headers.set(name, value);
  }
  return init;
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
  const url = assetUrl(written);
  if (url === null) return { request: entry.request, problems: [`no earlier answer in this case names ${written}`] };

  heard = [];
  const res = await app.request(`http://localhost${url}`, initFor(method, entry.send));
  const actual = { status: res.status, headers: res.headers, body: await res.text() };
  answers.push(actual.body);
  keepCookies(res.headers.getSetCookie());
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

/**
 * A URL with `[hash]` in it, as an earlier answer named it:
 * `/assets/global-[hash].css` becomes `/assets/global-Cyt6b9Zw.css`. A URL
 * with no `[hash]` is returned as written, and one no answer names is `null`.
 *
 * @param {string} url
 */
function assetUrl(url) {
  if (!url.includes('[hash]')) return url;
  const [before, after] = url.split('[hash]').map(literally);
  // Eight characters, the length `compare.js` counts as a hash.
  const pattern = new RegExp(`${before}[\\w-]{8}${after}`);
  for (const body of answers) {
    const found = body.match(pattern);
    if (found) return found[0];
  }
  return null;
}

/** Text as a regular expression that matches only that text. */
function literally(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Each `Set-Cookie` into the jar. One that has expired, by `Max-Age=0` or a
 * past `Expires`, takes the name out. Path and domain are not read: a case is
 * one host, and the paths in it are short.
 *
 * @param {string[]} setCookies
 */
function keepCookies(setCookies) {
  for (const line of setCookies) {
    const [pair, ...attributes] = line.split(';').map((part) => part.trim());
    const at = pair.indexOf('=');
    const name = pair.slice(0, at);
    const value = pair.slice(at + 1);
    if (isExpired(attributes)) jar.delete(name);
    else jar.set(name, value);
  }
}

/** @param {string[]} attributes */
function isExpired(attributes) {
  for (const attribute of attributes) {
    const [key, value = ''] = attribute.split('=');
    const name = key.toLowerCase();
    if (name === 'max-age' && Number(value) <= 0) return true;
    if (name === 'expires' && Date.parse(value) <= Date.now()) return true;
  }
  return false;
}
