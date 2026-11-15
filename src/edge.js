// The headers for files the edge serves itself.
//
// On Cloudflare, a file in a worker's assets directory is answered before the
// worker runs. So none of the headers `baseApp` adds reach it: not `nosniff`,
// not the CSP header, not the long cache on a hashed asset. `_headers` is how
// that platform is told to add them, and the build writes one into
// `dist/edge` from the same config the server reads.

import { headerPolicy } from './csp.js';
import { permissionsHeader } from './permissions.js';
/**
 * The cache on a hashed asset. The same string as `IMMUTABLE` in `app.js`,
 * which is not exported: `test/edge.test.js` asks the app for an asset and
 * compares, so the two cannot drift apart.
 */
export const IMMUTABLE = 'public, max-age=31536000, immutable';

/** Cloudflare drops a `_headers` line longer than this, and says nothing. */
export const MAX_LINE = 2000;

/**
 * The `_headers` file for `dist/edge`: what `baseApp` sets on every response,
 * for every file, and the immutable cache for the hashed ones under `/assets/`.
 * An app's own `_headers` in its public directory follows it, so the
 * platform applies both.
 *
 * @param {{ csp?: any, permissionsPolicy?: any }} config the app's config
 * @param {string} [own] the app's own `_headers`, if its public directory has one
 * @returns {string}
 */
export function edgeHeaders(config, own = '') {
  const everywhere = ['X-Content-Type-Options: nosniff'];

  const csp = headerPolicy(config.csp);
  if (csp) everywhere.push(`${csp.name}: ${csp.value}`);

  const permissions = permissionsHeader(config.permissionsPolicy);
  if (permissions) everywhere.push(`${permissions.name}: ${permissions.value}`);

  const lines = ['/*', ...everywhere.map((header) => `  ${header}`), '', '/assets/*', `  Cache-Control: ${IMMUTABLE}`];
  refuseLongLines(lines);

  const written = lines.join('\n') + '\n';
  return own ? `${written}\n${own.trimEnd()}\n` : written;
}

/**
 * Refuses a header the platform would drop. A long CSP is the one that gets
 * there, and a site without its CSP looks exactly like a site with it.
 *
 * @param {string[]} lines
 */
function refuseLongLines(lines) {
  const long = lines.find((line) => line.length > MAX_LINE);
  if (!long) return;
  const name = long.trim().split(':')[0];
  throw new Error(
    `[transclude] The ${name} header is ${long.trim().length} characters, and Cloudflare ` +
      `drops a _headers line longer than ${MAX_LINE}. Shorten it, or serve the files ` +
      `through the worker.`,
  );
}
