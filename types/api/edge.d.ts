/**
 * The cache on a hashed asset. The same string as `IMMUTABLE` in `app.js`,
 * which is not exported: `test/edge.test.js` asks the app for an asset and
 * compares, so the two cannot drift apart.
 */
export declare const IMMUTABLE = "public, max-age=31536000, immutable";
/** Cloudflare drops a `_headers` line longer than this, and says nothing. */
export declare const MAX_LINE = 2000;
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
export declare function edgeHeaders(config: {
    csp?: any;
    permissionsPolicy?: any;
}, own?: string): string;
