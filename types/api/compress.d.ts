export declare const COMPRESSIBLE_FLOOR = 512;
/**
 * Compresses a response as it goes out. Async so the work lands on libuv's
 * thread pool rather than the event loop.
 *
 * @param {Buffer|Uint8Array} body
 * @param {'br'|'gzip'|string} encoding anything else is returned unchanged
 * @returns {Promise<Buffer|Uint8Array>}
 */
export declare function compressResponse(body: Buffer | Uint8Array, encoding: 'br' | 'gzip' | string): Promise<Buffer | Uint8Array>;
/**
 * Writes a `.br` and a `.gz` beside every compressible file in `dirs`.
 *
 * @param {string[]} dirs
 * @param {{ floor?: number, concurrency?: number }} [options] `floor` is the
 *   size below which framing costs more than it saves
 * @returns {Promise<{ files: number, raw: number, gzip: number, brotli: number }>}
 */
export declare function precompress(dirs: string[], { floor, concurrency }?: {
    floor?: number;
    concurrency?: number;
}): Promise<{
    files: number;
    raw: number;
    gzip: number;
    brotli: number;
}>;
