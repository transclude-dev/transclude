export type Entry = {
    url: string;
    revision: string | null;
};
/**
 * @param {object} sources
 * @param {Iterable<[string, { etag?: string }]>} sources.pages prerendered documents
 * @param {Iterable<[string, unknown]>} sources.assets hashed build output
 * @param {Iterable<[string, { etag?: string }]>} [sources.files] the author's public files
 * @returns {Entry[]} sorted by URL, so two builds of the same site agree
 */
export declare function precacheList({ pages, assets, files }: {
    pages: Iterable<[string, {
        etag?: string;
    }]>;
    assets: Iterable<[string, unknown]>;
    files?: Iterable<[string, {
        etag?: string;
    }]>;
}): Entry[];
/**
 * The document served at `/precache.json`.
 *
 * `version` changes when any entry does, so a service worker can name its cache
 * after it and drop the old one on activate without comparing lists.
 *
 * @param {Entry[]} entries
 * @param {string} version
 * @returns {string} JSON, with a trailing newline
 */
export declare function precacheDocument(entries: Entry[], version: string): string;
/** Where it is served, and where the build writes it under `static/`. */
export declare const PRECACHE_PATH = "/precache.json";
