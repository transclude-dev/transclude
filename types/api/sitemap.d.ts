/**
 * Every URL the sitemap lists, in route order.
 *
 * `paths()` is the page's own, the one the build calls, so the two cannot
 * disagree about which URLs exist.
 *
 * @param {object} manifest
 * @param {Record<string, object>} pages
 * @param {{ entries?: object[] | (() => object[] | Promise<object[]>),
 *   exclude?: string[] }} [config] `entries` may be a function, so an app can
 *   build them from its own data rather than list them
 * @returns {Promise<Array<{ path: string, lastmod?: string }>>}
 */
export declare function sitemapEntries(manifest: object, pages: Record<string, object>, { entries, exclude }?: {
    entries?: object[] | (() => object[] | Promise<object[]>);
    exclude?: string[];
}): Promise<Array<{
    path: string;
    lastmod?: string;
}>>;
/**
 * The document for one request.
 *
 * Past the cap the bare path answers with an index and `?p=` answers with a
 * slice, because a file over 50000 URLs is not a sitemap a crawler will read.
 *
 * @param {object} manifest
 * @param {Record<string, object>} pages
 * @param {object} config the `sitemap` block, which has to name a hostname
 * @param {number|null} [page] which sheet, when there are more URLs than one holds
 * @returns {Promise<string>} an XML document
 */
export declare function sitemap(manifest: object, pages: Record<string, object>, config: object, page?: number | null): Promise<string>;
