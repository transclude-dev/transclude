export type Entry = {
    body: Buffer;
    etag: string;
    /**
     * one per content encoding
     */
    encodings: Map<string, {
        body: Buffer;
        etag: string;
    }>;
    /**
     * the Content-Type to send
     */
    type: string;
};
export type Store = {
    count: number;
    /**
     * held in memory
     */
    bytes: number;
    /**
     * left on disk because the budget ran out
     */
    onDisk: number;
    /**
     * how many have a precompressed variant
     */
    encoded: number;
    /**
     * for the build, which
     * serializes these for a runtime with no filesystem
     */
    entries: Map<string, Entry | {
        file: string;
    }>;
    get: (pathname: string) => Entry | null;
};
/**
 * @typedef {object} Entry
 * @property {Buffer} body
 * @property {string} etag
 * @property {Map<string, { body: Buffer, etag: string }>} encodings one per content encoding
 * @property {string} type the Content-Type to send
 */
/**
 * @typedef {object} Store
 * @property {number} count
 * @property {number} bytes held in memory
 * @property {number} onDisk left on disk because the budget ran out
 * @property {number} encoded how many have a precompressed variant
 * @property {Map<string, Entry|{ file: string }>} entries for the build, which
 *   serializes these for a runtime with no filesystem
 * @property {(pathname: string) => Entry|null} get
 */
/**
 * Prerendered pages, keyed by the URL they stand for.
 *
 * @param {string} dir the directory of built pages
 * @param {{ maxBytes?: number }} [options] how much to hold in memory
 * @returns {Store}
 */
export declare function loadStatic(dir: string, options?: {
    maxBytes?: number;
}): Store;
/**
 * Build assets, keyed by their path under the output directory.
 *
 * @param {string} dir
 * @param {{ maxBytes?: number }} [options]
 * @returns {Store}
 */
export declare function loadAssets(dir: string, options?: {
    maxBytes?: number;
}): Store;
/**
 * A cache key for a body, not a signature.
 *
 * Truncated on purpose: this says whether two responses are the same bytes, and
 * nothing trusts it for anything else. Anything that needs a digest a browser
 * will agree with uses `crypto.subtle`.
 *
 * @param {Buffer|Uint8Array|string} body
 * @returns {string} a quoted ETag
 */
export declare function etagOf(body: Buffer | Uint8Array | string): string;
