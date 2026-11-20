/**
 * Every URL the sitemap lists, in route order.
 *
 * `paths()` is the page's own, the one the build calls, so the two cannot
 * disagree about which URLs exist.
 *
 * A path named twice is one entry, carrying the fields of every mention. That
 * is how a page built from `paths()` gets a `lastmod`: the route table knows
 * the URL and nothing else, and `entries` names the same URL with the date.
 *
 * @param {Pick<import('./routes.js').Manifest, 'routes'|'gated'>} manifest the
 *   two fields read here. The dev server has no endpoint list to give, and
 *   nothing here would read one.
 * @param {Record<string, import('./document.js').PageModule>} pages
 * @param {SitemapConfig} [config]
 * @returns {Promise<Array<{ path: string, lastmod?: string }>>}
 */
export declare function sitemapEntries(manifest: Pick<import('./routes.js').Manifest, 'routes' | 'gated'>, pages: Record<string, import('./document.js').PageModule>, { entries, exclude }?: SitemapConfig): Promise<Array<{
    path: string;
    lastmod?: string;
}>>;
export type SitemapEntry = {
    /**
     * a path on this site, beginning with one `/`
     */
    path: string;
    /**
     * written as the day in UTC. A
     * value that is no date is left out
     */
    lastmod?: Date | string | number | null;
    /**
     * any other value fails the build
     */
    changefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never' | null;
    /**
     * from 0 to 1. Any other value fails the build
     */
    priority?: number | null;
};
export type SitemapConfig = {
    /**
     * every URL is absolute, so this is required. An
     * origin, like `https://acme.com`, with no path
     */
    hostname?: string;
    /**
     * URLs per sheet, past which an index is written. A
     * whole number from 1 to 50000
     */
    limit?: number | null;
    /**
     * URLs the route table cannot know. A function, so an app builds them from
     * its own data rather than listing them.
     */
    entries?: SitemapEntry[] | (() => SitemapEntry[] | Promise<SitemapEntry[]>);
    /**
     * a path to leave out, beginning
     * with `/`, or a pattern the path has to match. Tested against the path as
     * the `loc` writes it, encoded, and not against the absolute URL.
     */
    exclude?: Array<string | RegExp> | null;
};
/**
 * One URL in `entries`.
 *
 * @typedef {object} SitemapEntry
 * @property {string} path a path on this site, beginning with one `/`
 * @property {Date|string|number|null} [lastmod] written as the day in UTC. A
 *   value that is no date is left out
 * @property {'always'|'hourly'|'daily'|'weekly'|'monthly'|'yearly'|'never'|null} [changefreq]
 *   any other value fails the build
 * @property {number|null} [priority] from 0 to 1. Any other value fails the build
 */
/**
 * The `sitemap` block of a config.
 *
 * @typedef {object} SitemapConfig
 * @property {string} [hostname] every URL is absolute, so this is required. An
 *   origin, like `https://acme.com`, with no path
 * @property {number|null} [limit] URLs per sheet, past which an index is written. A
 *   whole number from 1 to 50000
 * @property {SitemapEntry[]|(() => SitemapEntry[]|Promise<SitemapEntry[]>)} [entries]
 *   URLs the route table cannot know. A function, so an app builds them from
 *   its own data rather than listing them.
 * @property {Array<string|RegExp>|null} [exclude] a path to leave out, beginning
 *   with `/`, or a pattern the path has to match. Tested against the path as
 *   the `loc` writes it, encoded, and not against the absolute URL.
 */
/**
 * Every file the sitemap is, by the path it is served at.
 *
 * Under the cap that is `/sitemap.xml` alone. Past it, `/sitemap.xml` is the
 * index and each sheet is its own file. The build writes every one, and the
 * server answers the same paths from the same list, so a static host and the
 * server cannot disagree about which sheets exist.
 *
 * Every sheet is built for any one request. The cost is the string work on
 * the list `paths()` already gave, which is small beside `paths()` itself.
 *
 * @param {Pick<import('./routes.js').Manifest, 'routes'|'gated'>} manifest the
 *   two fields read here. The dev server has no endpoint list to give, and
 *   nothing here would read one.
 * @param {Record<string, import('./document.js').PageModule>} pages
 * @param {SitemapConfig} config the `sitemap` block, which has to name a hostname
 * @returns {Promise<Map<string, string>>} each path, like `/sitemap-0.xml`, to its XML
 */
export declare function sitemapFiles(manifest: Pick<import('./routes.js').Manifest, 'routes' | 'gated'>, pages: Record<string, import('./document.js').PageModule>, config: SitemapConfig): Promise<Map<string, string>>;
/**
 * The document for one request.
 *
 * @param {Pick<import('./routes.js').Manifest, 'routes'|'gated'>} manifest the
 *   two fields read here. The dev server has no endpoint list to give, and
 *   nothing here would read one.
 * @param {Record<string, import('./document.js').PageModule>} pages
 * @param {SitemapConfig} config the `sitemap` block, which has to name a hostname
 * @param {string} [file] the path asked for, `/sitemap.xml` or a sheet
 * @returns {Promise<string|null>} an XML document, or null for a sheet that is
 *   not one of the files, which the server answers with a 404
 */
export declare function sitemap(manifest: Pick<import('./routes.js').Manifest, 'routes' | 'gated'>, pages: Record<string, import('./document.js').PageModule>, config: SitemapConfig, file?: string): Promise<string | null>;
