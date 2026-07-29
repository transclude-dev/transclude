// Built output, held in memory with an ETag per representation.
//
// The files are immutable for the life of the process — they were produced at
// build time — so the only reason to touch the disk again is if there are more
// of them than we are willing to hold.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

/** Prerendered pages, keyed by the URL they stand for. */
export function loadStatic(dir, options = {}) {
  return load(dir, pageUrl, options);
}

/** Build assets, keyed by their path under the output directory. */
export function loadAssets(dir, options = {}) {
  return load(dir, (relative) => `/${relative.split(path.sep).join('/')}`, options);
}

function load(dir, urlFor, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const entries = new Map();
  let bytes = 0;
  let onDisk = 0;

  for (const file of walk(dir)) {
    // .br and .gz are variants of a sibling, not resources of their own.
    if (file.endsWith('.br') || file.endsWith('.gz')) continue;

    const url = urlFor(path.relative(dir, file));
    if (url === null) continue;

    const size = fs.statSync(file).size + variantSize(file);
    if (bytes + size > maxBytes) {
      entries.set(url, { file });
      onDisk++;
      continue;
    }

    bytes += size;
    entries.set(url, read(file));
  }

  return {
    count: entries.size,
    bytes,
    onDisk,
    encoded: [...entries.values()].filter((e) => e.encodings?.size).length,

    /** Entry for a request path, or null. Trailing slashes are the same resource. */
    get(pathname) {
      const clean = pathname.replace(/\/+$/, '') || '/';
      const hit = entries.get(clean);
      if (!hit) return null;
      return hit.body !== undefined ? hit : read(hit.file);
    },
  };
}

function read(file) {
  const body = fs.readFileSync(file);
  const etag = etagOf(body);
  const encodings = new Map();

  // Each encoding is a distinct representation, so it needs a distinct ETag —
  // otherwise a shared cache can hand a brotli body to a client that asked for
  // gzip, and the mismatch is invisible until it fails to decode.
  for (const [encoding, suffix] of [['br', '.br'], ['gzip', '.gz']]) {
    const variant = `${file}${suffix}`;
    if (!fs.existsSync(variant)) continue;
    encodings.set(encoding, {
      body: fs.readFileSync(variant),
      etag: `${etag.slice(0, -1)}-${encoding}"`,
    });
  }

  return { body, etag, encodings, type: TYPES[path.extname(file)] ?? 'application/octet-stream' };
}

export function etagOf(body) {
  return `"${createHash('sha1').update(body).digest('base64url').slice(0, 20)}"`;
}

function variantSize(file) {
  let total = 0;
  for (const suffix of ['.br', '.gz']) {
    const variant = `${file}${suffix}`;
    if (fs.existsSync(variant)) total += fs.statSync(variant).size;
  }
  return total;
}

/** `index.html` -> `/`, `people/ada/index.html` -> `/people/ada`, `404.html` -> null. */
function pageUrl(relative) {
  const posix = relative.split(path.sep).join('/');
  if (posix === 'index.html') return '/';
  if (posix.endsWith('/index.html')) return `/${posix.slice(0, -'/index.html'.length)}`;
  return null;
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
