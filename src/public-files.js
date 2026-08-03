// The author's own files, served from disk.
//
// Node only, and deliberately outside the portable core: `app.js` is handed a
// handler and never builds one, which is what lets a runtime with no filesystem
// supply its own. Nothing here is reachable from that graph.
//
// These are not build output. They can be large, they can be media, and media
// needs byte ranges, which is why they go through Hono's `serveStatic` rather
// than the in-memory cache. What that leaves out is a validator: the response
// carried `Last-Modified` and nothing else, so a browser fell back to guessing
// how long to hold a favicon.

import fs from 'node:fs';
import { serveStatic } from '@hono/node-server/serve-static';

/** Same as the build output's. These change when the author changes them. */
const REVALIDATE = 'public, max-age=0, must-revalidate';

/**
 * Size and modified time, not a hash of the bytes.
 *
 * Hashing is what the in-memory cache does, and it is the wrong trade here: a
 * video would be read in full to answer a request that may only want the first
 * megabyte of it. Weak on purpose, because two files can share a size and a
 * second: it is enough to answer "has this changed", which is all a conditional
 * request asks, and it does not claim the byte-for-byte identity a strong one
 * does.
 *
 * @param {string} file
 * @returns {string}
 */
function validatorFor(file) {
  const { size, mtimeMs } = fs.statSync(file);
  return `W/"${size.toString(36)}-${Math.floor(mtimeMs).toString(36)}"`;
}

/**
 * A handler for `publicFiles`, with a validator and a 304.
 *
 * `serveStatic` sets the headers and reads no request condition, so the
 * conditional half is done around it. The file it found is the one measured,
 * which is the point when `precompressed` served a `.br`: different bytes are
 * a different entity and must not share an ETag.
 *
 * @param {string} root relative to the working directory
 * @returns {Function} Hono middleware
 */
export function publicFiles(root) {
  const inner = serveStatic({
    root,
    precompressed: true,
    onFound: (file, c) => {
      c.header('ETag', validatorFor(file));
      c.header('Cache-Control', REVALIDATE);
    },
  });

  return async (c, next) => {
    // Whatever it gives back is given back. A range is answered by *returning* a
    // Response rather than by setting `c.res`, so swallowing this leaves the
    // context unfinalized and every Range request becomes a 500. That is a
    // difference no unit test here saw: it took a real server and a real
    // `Range` header.
    const answer = await inner(c, next);
    const found = answer ?? c.res;

    // 206 is left alone. A range was asked for and answered, and a weak
    // validator is not one `If-Range` may be matched against.
    if (!found || found.status !== 200) return answer;

    const etag = found.headers.get('etag');
    if (etag && c.req.header('if-none-match') === etag) {
      return new Response(null, { status: 304, headers: found.headers });
    }
    return answer;
  };
}
