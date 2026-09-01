/**
 * Every URL the sitemap lists, in route order.
 *
 * `paths()` is the page's own, the one the build calls, so the two cannot
 * disagree about which URLs exist.
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
export type SitemapConfig = {
    /**
     * every URL is absolute, so this is required
     */
    hostname?: string;
    /**
     * URLs per sheet, past which an index is written
     */
    limit?: number;
    /**
     * URLs the
     * route table cannot know. A function, so an app builds them from its own
     * data rather than listing them.
     */
    entries?: object[] | (() => object[] | Promise<object[]>);
    exclude?: string[];
};
/**
 * The `sitemap` block of a config.
 *
 * @typedef {object} SitemapConfig
 * @property {string} [hostname] every URL is absolute, so this is required
 * @property {number} [limit] URLs per sheet, past which an index is written
 * @property {object[]|(() => object[]|Promise<object[]>)} [entries] URLs the
 *   route table cannot know. A function, so an app builds them from its own
 *   data rather than listing them.
 * @property {string[]} [exclude]
 */
/**
 * The document for one request.
 *
 * Past the cap the bare path answers with an index and `?p=` answers with a
 * slice, because a file over 50000 URLs is not a sitemap a crawler will read.
 *
 * @param {Pick<import('./routes.js').Manifest, 'routes'|'gated'>} manifest the
 *   two fields read here. The dev server has no endpoint list to give, and
 *   nothing here would read one.
 * @param {Record<string, import('./document.js').PageModule>} pages
 * @param {SitemapConfig} config the `sitemap` block, which has to name a hostname
 * @param {string|number|null} [page] which sheet, when there are more URLs than
 *   one holds. A string, because it arrives as `?p=`, and `Number` reads it.
 * @returns {Promise<string>} an XML document
 */
export declare function sitemap(manifest: Pick<import('./routes.js').Manifest, 'routes' | 'gated'>, pages: Record<string, import('./document.js').PageModule>, config: SitemapConfig, page?: string | number | null): Promise<string>;
