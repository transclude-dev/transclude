// What a file is, in one place.
//
// Three things answered this before, and they disagreed. `static-cache.js` had a
// table of thirteen, `bin/build.js` had a table of eleven, and public files on
// Node took whatever Hono's own table said. So `kitchen.m4a` was
// `application/octet-stream` everywhere, and `room.mp3` was `audio/mpeg` on Node
// and `application/octet-stream` on workerd: the same app, the same file, two
// answers depending on where it was deployed.
//
// `nosniff` is on every response, which is what makes an unknown type a refusal
// rather than a degradation. A browser is told it may not guess, so an `<audio>`
// element handed `application/octet-stream` has no way to play bytes it can see
// are AAC. That header stays: the fix for a wrong type is the right type.
//
// This table is a superset of Hono's, which `test/mime.test.js` holds, because
// the public-file handler answers over the top of Hono's and must never lose a
// type it would have got right.
//
// No imports. The build reaches this, both servers reach it, and a worker bundle
// must not drag a filesystem in behind it.

/** What a file of a kind nobody here knows is sent as. */
export const DEFAULT_TYPE = 'application/octet-stream';

/**
 * Extension, without the dot, to Content-Type.
 *
 * A text type carries `charset=utf-8`, since that is what this framework writes
 * and a browser otherwise guesses per locale. Binary types carry no charset.
 */
export const TYPES = {
  // Markup and code
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  xhtml: 'application/xhtml+xml; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  wasm: 'application/wasm',

  // Data and documents
  json: 'application/json; charset=utf-8',
  jsonld: 'application/ld+json',
  map: 'application/json; charset=utf-8',
  webmanifest: 'application/manifest+json',
  xml: 'application/xml; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  ics: 'text/calendar; charset=utf-8',
  pdf: 'application/pdf',
  rtf: 'application/rtf',
  epub: 'application/epub+zip',
  zip: 'application/zip',
  gz: 'application/gzip',
  bin: 'application/octet-stream',

  // Images
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  tif: 'image/tiff',
  tiff: 'image/tiff',

  // Audio. `m4a` is the one that started this: an AAC file in an MP4 container,
  // which is `audio/mp4` rather than anything with "m4a" in it.
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  aac: 'audio/aac',
  wav: 'audio/wav',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/opus',
  weba: 'audio/webm',
  mid: 'audio/x-midi',
  midi: 'audio/x-midi',

  // Video
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  webm: 'video/webm',
  ogv: 'video/ogg',
  ogx: 'application/ogg',
  mpeg: 'video/mpeg',
  avi: 'video/x-msvideo',
  av1: 'video/av1',
  // A transport stream, not TypeScript. Hono answers the same, and a `.ts` under
  // `public/` is either a stream segment or a source file nobody meant to
  // publish.
  ts: 'video/mp2t',
  m3u8: 'application/vnd.apple.mpegurl',
  vtt: 'text/vtt; charset=utf-8',
  '3gp': 'video/3gpp',
  '3g2': 'video/3gpp2',

  // Fonts
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',

  // Models
  gltf: 'model/gltf+json',
  glb: 'model/gltf-binary',
};

/** The extension of a file name, path or URL, lowercased, or null. */
function extensionOf(file) {
  const match = /\.([a-z0-9]+)$/i.exec(String(file ?? ''));
  if (!match) return null;

  return match[1].toLowerCase();
}

/**
 * Whether the table has a type for this file.
 *
 * `Object.hasOwn`, because the name comes off a URL: `/x.constructor` finds a
 * function on `Object.prototype` with a plain lookup, and the type of that file
 * would go out as `function Object() { [native code] }`. `.bin` is in the table
 * on purpose and is a known type, so this is not "does it come out as
 * octet-stream".
 *
 * @param {string} file
 * @returns {boolean}
 */
export function known(file) {
  const ext = extensionOf(file);
  return ext !== null && Object.hasOwn(TYPES, ext);
}

/**
 * The Content-Type for a file name, a path or a URL.
 *
 * @param {string} file
 * @returns {string} the type, or `application/octet-stream`
 */
export function typeOf(file) {
  if (!known(file)) return DEFAULT_TYPE;

  return TYPES[extensionOf(file)];
}
