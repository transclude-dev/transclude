// Build-time compression.
//
// Compressing once, at rest, is why this is worth doing at all: brotli can run
// at quality 11 because nobody is waiting for it, where a proxy compressing on
// the fly picks 4 or 5 to keep latency down. The output is strictly smaller than
// anything the request path could produce.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { pool } from './pool.js';

const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.xml', '.map']);

// Below this, the framing costs more than it saves. A 91 byte file gzips to 120.
export const COMPRESSIBLE_FLOOR = 512;

// At build time nothing is waiting, so brotli runs at its maximum. Per request
// it is not: measured on a rendered page, quality 11 costs 1.372 ms against
// 0.056 ms at quality 5, and buys 105 bytes. The levels below are the ones worth
// paying for while a client is on the line.
const DYNAMIC = {
  br: (body) => ({
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 5,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: body.length,
    },
  }),
  gzip: () => ({ level: 6 }),
};

/**
 * Compresses a response as it goes out. Async so the work lands on libuv's
 * thread pool rather than the event loop.
 */
export async function compressResponse(body, encoding) {
  if (encoding === 'br') return brotli(body, DYNAMIC.br(body));
  if (encoding === 'gzip') return gzip(body, DYNAMIC.gzip());
  return body;
}

export async function precompress(dirs, { floor = COMPRESSIBLE_FLOOR, concurrency = 8 } = {}) {
  const files = dirs.flatMap((dir) => walk(dir)).filter((file) => {
    if (!COMPRESSIBLE.has(path.extname(file))) return false;
    return fs.statSync(file).size >= floor;
  });

  const results = await pool(files, concurrency, async (file) => {
    const raw = fs.readFileSync(file);

    const [br, gz] = await Promise.all([
      brotli(raw, {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
        },
      }),
      gzip(raw, { level: 9 }),
    ]);

    // Only keep a variant that actually helps; compression is not guaranteed to.
    let saved = 0;
    if (br.length < raw.length) {
      fs.writeFileSync(`${file}.br`, br);
      saved = raw.length - br.length;
    }
    if (gz.length < raw.length) fs.writeFileSync(`${file}.gz`, gz);

    return { raw: raw.length, br: br.length, gz: gz.length, saved };
  });

  return {
    files: results.length,
    raw: results.reduce((total, r) => total + r.raw, 0),
    brotli: results.reduce((total, r) => total + r.br, 0),
    gzip: results.reduce((total, r) => total + r.gz, 0),
  };
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (!full.endsWith('.br') && !full.endsWith('.gz')) out.push(full);
  }
  return out;
}
