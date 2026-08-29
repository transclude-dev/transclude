/**
 * A route pattern as something `href_matches` understands.
 *
 * Hono writes `/docs/:path{.+}` and `/people/:name`. Both become `*`: the regex
 * half is Hono's own spelling and means nothing to a URL pattern, and a rule
 * that matches too little is a missed prefetch while one that matches too much
 * speculates a URL that 404s.
 *
 * @param {string} pattern
 * @returns {string}
 */
export declare function hrefPattern(pattern: string): string;
/**
 * The `<script type="speculationrules">` body for a site, or null.
 *
 * Two lists, because they are two different promises. `prerendered` is every URL
 * written to a file, and the browser may run those. `dynamic` is every route the
 * server still renders, and the browser may only fetch those: the response is
 * the same document a click would have got, and no page script runs early.
 *
 * Endpoints are in neither. A `.js` route answers with whatever it builds, and
 * speculating one spends a request on something no navigation will reuse.
 *
 * @param {object} site
 * @param {string[]} [site.prerendered] URLs written to a file
 * @param {string[]} [site.dynamic] route patterns the server renders
 * @param {object} [options]
 * @param {string[]} [options.exclude] patterns to leave out of both
 * @param {string} [options.eagerness] how soon the browser may act
 * @returns {string|null} JSON, or null when nothing is speculated
 * @throws when `eagerness` is not one the spec names
 */
export declare function speculationRules({ prerendered, dynamic }: {
    prerendered?: string[];
    dynamic?: string[];
}, options?: {
    exclude?: string[];
    eagerness?: string;
}): string | null;
/**
 * `speculate` as `{ exclude, eagerness }`, or null for off.
 *
 * Off by default, like every other thing here that changes what a browser is
 * told to do. `true` is the defaults.
 *
 * @param {boolean|object} [setting]
 * @returns {object|null}
 */
export declare function speculateSettings(setting?: boolean | object): object | null;
