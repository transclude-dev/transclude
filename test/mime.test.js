// One table decides what a file is.
//
// The bug this was written after: an `.m4a` in `app/public/` went out as
// `application/octet-stream`, and with `nosniff` on every response the browser
// was forbidden to look at the bytes and see AAC. It did not play badly. It did
// not play. Worse than that, `.mp3` was `audio/mpeg` on Node and
// `application/octet-stream` on workerd, because two of the three tables in this
// repository disagreed and the third was Hono's.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_TYPE, TYPES, known, typeOf } from '../src/mime.js';
import { loadAssets } from '../src/static-cache.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The code of a file in this repository, without the prose about it. */
function code(file) {
  return fs
    .readFileSync(path.join(root, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

test('the audio a site actually serves has a type', () => {
  // Written out rather than looped over the table: a loop asserts the table
  // agrees with itself, and deleting an entry makes it one shorter and still
  // green.
  assert.equal(typeOf('kitchen.m4a'), 'audio/mp4');
  assert.equal(typeOf('room.mp3'), 'audio/mpeg');
  assert.equal(typeOf('step.wav'), 'audio/wav');
  assert.equal(typeOf('hum.flac'), 'audio/flac');
  assert.equal(typeOf('drip.ogg'), 'audio/ogg');
  assert.equal(typeOf('drip.oga'), 'audio/ogg');
  assert.equal(typeOf('click.opus'), 'audio/opus');
  assert.equal(typeOf('bell.aac'), 'audio/aac');
  assert.equal(typeOf('loop.weba'), 'audio/webm');
});

test('so does the video, and the captions beside it', () => {
  assert.equal(typeOf('intro.mp4'), 'video/mp4');
  assert.equal(typeOf('intro.m4v'), 'video/x-m4v');
  assert.equal(typeOf('intro.mov'), 'video/quicktime');
  assert.equal(typeOf('intro.webm'), 'video/webm');
  assert.equal(typeOf('intro.ogv'), 'video/ogg');
  assert.equal(typeOf('intro.vtt'), 'text/vtt; charset=utf-8');
  assert.equal(typeOf('stream.m3u8'), 'application/vnd.apple.mpegurl');
});

test('and every font, not only the one a build writes', () => {
  assert.equal(typeOf('inter.woff2'), 'font/woff2');
  assert.equal(typeOf('inter.woff'), 'font/woff');
  assert.equal(typeOf('inter.ttf'), 'font/ttf');
  assert.equal(typeOf('inter.otf'), 'font/otf');
  assert.equal(typeOf('inter.eot'), 'application/vnd.ms-fontobject');
});

test('what the framework itself writes is unchanged', () => {
  assert.equal(typeOf('index.html'), 'text/html; charset=utf-8');
  assert.equal(typeOf('entry.js'), 'text/javascript; charset=utf-8');
  assert.equal(typeOf('global.css'), 'text/css; charset=utf-8');
  assert.equal(typeOf('routes.json'), 'application/json; charset=utf-8');
  assert.equal(typeOf('entry.js.map'), 'application/json; charset=utf-8');
  assert.equal(typeOf('icons.svg'), 'image/svg+xml');
  assert.equal(typeOf('favicon.ico'), 'image/x-icon');
});

test('nothing this table does not know pretends to be something', () => {
  assert.equal(typeOf('archive.7z'), DEFAULT_TYPE);
  assert.equal(typeOf('README'), DEFAULT_TYPE);
  assert.equal(typeOf(''), DEFAULT_TYPE);
  assert.equal(typeOf(undefined), DEFAULT_TYPE);
});

test('a name off a URL cannot reach Object.prototype', () => {
  // `/x.constructor` found a function with a plain lookup, and the header would
  // have gone out as its source. Same shape as the region lookup in `app.js`.
  assert.equal(typeOf('x.constructor'), DEFAULT_TYPE);
  assert.equal(typeOf('x.__proto__'), DEFAULT_TYPE);
  assert.equal(typeOf('x.toString'), DEFAULT_TYPE);
  assert.equal(known('x.constructor'), false);
});

test('the extension is read whatever case it was written in', () => {
  assert.equal(typeOf('KITCHEN.M4A'), 'audio/mp4');
  assert.equal(typeOf('/audio/Room.Mp3'), 'audio/mpeg');
});

test('`known` is about the table, not about the answer', () => {
  // `.bin` is in the table and its type is `application/octet-stream`, which is
  // correct rather than missing. The build's notice reads this, so a `.bin`
  // download must not be reported as a file nobody could type.
  assert.equal(typeOf('firmware.bin'), DEFAULT_TYPE);
  assert.equal(known('firmware.bin'), true);
  assert.equal(known('firmware.7z'), false);
});

test('the table covers everything Hono answers, so nothing is lost by answering over it', async () => {
  // `public-files.js` writes its own Content-Type over the one `serveStatic`
  // already set. That is only safe while this holds: an extension Hono types and
  // this table does not would go from a real type to `application/octet-stream`.
  const { mimes } = await import('hono/utils/mime');

  const missing = Object.keys(mimes).filter((ext) => !Object.hasOwn(TYPES, ext));
  assert.deepEqual(missing, [], `Hono types these and this table does not: ${missing.join(', ')}`);
});

test('the store that holds build output reads the same table', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'transclude-mime-'));
  try {
    fs.writeFileSync(path.join(dir, 'theme.m4a'), 'x'.repeat(600));
    fs.writeFileSync(path.join(dir, 'sheet.css'), 'x'.repeat(600));

    const assets = loadAssets(dir);
    assert.equal(assets.get('/theme.m4a').type, 'audio/mp4');
    assert.equal(assets.get('/sheet.css').type, 'text/css; charset=utf-8');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('nothing keeps a second table', () => {
  // Two of these had one, and they disagreed with each other and with Hono. The
  // check is for the types rather than for the word "table": a copy would be
  // spelled some other way and still be a copy.
  for (const file of ['src/static-cache.js', 'bin/build.js', 'src/public-files.js']) {
    const source = code(file);

    assert.match(source, /from '(\.|\.\.\/src)\/mime\.js'/, `${file} does not reach the table`);
    assert.doesNotMatch(source, /'image\/png'|'font\/woff2'|'text\/css; charset=utf-8'/, `${file} names a type of its own`);
  }
});

test('the build says which public files it could not type', () => {
  // A quiet `application/octet-stream` under `nosniff` is a file the browser
  // refuses. The build names the kinds it could not type, the way it names a
  // draft it skipped.
  const source = code('bin/build.js');

  assert.match(source, /untypedExtensions\(/);
  assert.match(source, /known\(file\)/);
  assert.match(source, /application\/octet-stream/);
  assert.match(source, /nosniff/i);
});
