// The Node wiring for the built app: bytes off a disk, an ETag, the
// precompressed siblings, and the public directory.
//
// `app.js` is the app and names no runtime. This file is the part that does, so
// what it needs is a real `dist` on disk rather than a store in memory.
// `portable.test.js` covers the other side of that split.
//
// Every export here is worked out at import time from `process.cwd()`, so each
// fixture is imported under a query string of its own. A second plain import
// hands back the first project's app, and the second test then passes by
// checking the first one again.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const ENTRY = `
export const pages = {
  index: {
    revalidate: 0, layouts: [], css: '', headScript: '', hasTitle: false,
    renderTitle: () => '', renderHead: () => '', elements: [], includes: [], regions: {},
    load: async () => ({}),
    render: () => ({ default: '<p>rendered</p>' }),
  },
};
export const endpoints = {};
export const middleware = null;
export const gated = [];
`;

const NOT_FOUND = '<!doctype html><title>Gone</title><p>No page answers that URL.</p>';

/** A project with a build in it, or without one when `build` is false. */
function project({ build = true, publicFiles = true } = {}) {
  // `realpathSync`, because on macOS `os.tmpdir()` is a symlink into `/private`
  // and `loadProject` resolves the root through it.
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tc-prod-')));
  const write = (rel, body) => {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    return file;
  };

  write('transclude.config.js', "export default { appDir: 'app', routesDir: 'routes', outDir: 'dist' };\n");
  write('app/routes/index.html', '<h1>Home</h1>\n');
  if (!build) return dir;

  write('dist/routes.json', JSON.stringify({
    routes: [{ id: 'index', pattern: '/', params: [], client: null }],
    dynamic: [{ id: 'live', pattern: '/live' }],
    endpoints: [],
  }));
  write('dist/server/entry.js', ENTRY);

  // A prerendered page is `<name>/index.html` under `static/`. A 404 page is
  // not a URL, so `loadStatic` leaves it out and the app reaches for it by name.
  const about = '<!doctype html><p>about</p>';
  write('dist/static/about/index.html', about);
  fs.writeFileSync(path.join(dir, 'dist/static/about/index.html.br'), zlib.brotliCompressSync(Buffer.from(about)));
  write('dist/static/404.html', NOT_FOUND);
  fs.writeFileSync(path.join(dir, 'dist/static/404.html.br'), zlib.brotliCompressSync(Buffer.from(NOT_FOUND)));
  fs.writeFileSync(path.join(dir, 'dist/static/404.html.gz'), zlib.gzipSync(Buffer.from(NOT_FOUND)));
  write('dist/static/500.html', '<!doctype html><p>broke</p>');
  write('dist/client/assets/app-a1b2c3.js', 'console.log(1)\n');
  if (publicFiles) write('dist/public/robots.txt', 'User-agent: *\n');

  return dir;
}

let fixtures = 0;

/**
 * Imports the module fresh, with the project as the working directory.
 *
 * The directory stays current for the whole test, because `serveStatic`
 * resolves its root against the working directory when a request arrives
 * rather than when the app is built. A real server never moves; this one would
 * if the test put it back before asking for a file.
 */
async function serverIn(dir, t) {
  const was = process.cwd();
  process.chdir(dir);
  t.after(() => process.chdir(was));
  return import(`../src/production.js?fixture=${++fixtures}`);
}

/** What `summary` printed, as lines. */
function printed(run) {
  const lines = [];
  const wrote = console.log;
  console.log = (line) => lines.push(String(line));
  try {
    run();
  } finally {
    console.log = wrote;
  }
  return lines;
}

// ---- serving what the build wrote ------------------------------------------

test('a prerendered page is served from its file', async (t) => {
  const server = await serverIn(project(), t);

  const out = await server.app.request('http://x/about');

  assert.equal(server.noBuild, false);
  assert.equal(out.status, 200);
  assert.match(await out.text(), /<p>about<\/p>/);
});

test('the 404 page comes from the build, not from a render', async (t) => {
  // It is read by name rather than routed to. A page that has to render after a
  // request already failed can fail too, so this one is always bytes.
  const server = await serverIn(project(), t);

  const out = await server.app.request('http://x/nothing-here');

  assert.equal(out.status, 404);
  assert.match(await out.text(), /No page answers that URL/);
});

test('a precompressed sibling is sent, with an ETag of its own', async (t) => {
  // The build compresses once and writes `.br` and `.gz` beside the file. The
  // ETag has to differ per encoding: one ETag over two different bodies is a
  // cache handing a br body to a client that asked for gzip.
  const server = await serverIn(project(), t);

  const plain = await server.app.request('http://x/nothing-here');
  const brotli = await server.app.request('http://x/nothing-here', {
    headers: { 'accept-encoding': 'br' },
  });
  const gzip = await server.app.request('http://x/nothing-here', {
    headers: { 'accept-encoding': 'gzip' },
  });

  assert.equal(brotli.headers.get('Content-Encoding'), 'br');
  assert.equal(gzip.headers.get('Content-Encoding'), 'gzip');
  assert.match(brotli.headers.get('ETag'), /-br"$/);
  assert.match(gzip.headers.get('ETag'), /-gzip"$/);
  assert.notEqual(plain.headers.get('ETag'), brotli.headers.get('ETag'));
  assert.notEqual(brotli.headers.get('ETag'), gzip.headers.get('ETag'));

  // Same resource either way, so the bytes have to come back to the same text.
  assert.equal(zlib.brotliDecompressSync(Buffer.from(await brotli.arrayBuffer())).toString(), NOT_FOUND);
});

test('a public file is served from the project it was started in', async (t) => {
  // `serveStatic` joins its root onto the request path and resolves the result
  // against the working directory, so the path handed to it is relative to
  // where the process runs rather than to where this file sits.
  const server = await serverIn(project(), t);

  const out = await server.app.request('http://x/robots.txt');

  assert.equal(out.status, 200);
  assert.match(await out.text(), /User-agent/);
});

test('an app with no public directory still starts', async (t) => {
  const server = await serverIn(project({ publicFiles: false }), t);

  assert.equal((await server.app.request('http://x/robots.txt')).status, 404);
  assert.equal((await server.app.request('http://x/about')).status, 200);
});

test('a server started inside its own public directory still serves it', async (t) => {
  // `path.relative` answers '' for a directory against itself, and an empty
  // root is not a directory `serveStatic` can join a request path onto. The
  // config is found by walking up, so this cwd is unusual rather than wrong.
  const dir = project();
  const server = await serverIn(path.join(dir, 'dist/public'), t);

  const out = await server.app.request('http://x/robots.txt');

  assert.equal(out.status, 200);
  assert.match(await out.text(), /User-agent/);
});


// ---- what it prints --------------------------------------------------------

test('the summary counts what the build wrote', async (t) => {
  const server = await serverIn(project(), t);

  const lines = printed(() => server.summary(1960)).join('\n');

  assert.match(lines, /http:\/\/localhost:1960/);
  assert.match(lines, /prerendered\s+1 pages/);
  assert.match(lines, /assets\s+1 files/);
  // The 404 carries both variants, so one of the two resources is encoded.
  assert.match(lines, /precompressed 1\/2 resources/);
  assert.match(lines, /on demand\s+\/live/);
});

// ---- the warning that says why an edit is not showing up -------------------

test('a source newer than the build says so, and names the file', async (t) => {
  // This server reads `dist`, never the source. An edit made since the last
  // build looks exactly like an edit that did not work, which is an afternoon.
  const dir = project();
  const built = path.join(dir, 'dist/routes.json');
  const source = path.join(dir, 'app/routes/index.html');
  const at = fs.statSync(built).mtime;
  fs.utimesSync(source, at, new Date(at.getTime() + 42_000));

  const server = await serverIn(dir, t);
  const lines = printed(() => server.summary(1960)).join('\n');

  assert.match(lines, /app\/routes\/index\.html changed 42s after the last build/);
  assert.match(lines, /This server reads dist\//);
  assert.match(lines, /npm run build/);
});

test('a build newer than every source says nothing', async (t) => {
  const dir = project();
  const source = path.join(dir, 'app/routes/index.html');
  const at = fs.statSync(source).mtime;
  fs.utimesSync(path.join(dir, 'dist/routes.json'), at, new Date(at.getTime() + 42_000));

  const server = await serverIn(dir, t);
  const lines = printed(() => server.summary(1960)).join('\n');

  assert.doesNotMatch(lines, /after the last build/);
});

test('the config counts as a source', async (t) => {
  // It is not under `appDir`, and changing it changes what the build would
  // produce, so a config edited after a build is the same stale state.
  const dir = project();
  const built = path.join(dir, 'dist/routes.json');
  const at = fs.statSync(built).mtime;
  fs.utimesSync(path.join(dir, 'transclude.config.js'), at, new Date(at.getTime() + 9_000));

  const server = await serverIn(dir, t);
  const lines = printed(() => server.summary(1960)).join('\n');

  assert.match(lines, /transclude\.config\.js changed 9s after the last build/);
});

// ---- no build at all -------------------------------------------------------

test('with no dist the app still answers, and nothing pretends to be stale', async (t) => {
  const server = await serverIn(project({ build: false }), t);

  assert.equal(server.noBuild, true);
  const lines = printed(() => server.summary(1960)).join('\n');
  assert.doesNotMatch(lines, /after the last build/);
});
