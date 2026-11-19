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
export declare function validatorFor(file: string): string;
/**
 * A handler for `publicFiles`, with a validator, a type and a 304.
 *
 * `serveStatic` sets the headers and reads no request condition, so the
 * conditional half is done around it. The file it found is the one measured,
 * which is the point when `precompressed` served a `.br`: different bytes are
 * a different entity and must not share an ETag.
 *
 * @param {string} root absolute, or relative to the working directory
 * @returns {import('hono').MiddlewareHandler} Hono middleware
 */
export declare function publicFiles(root: string): import('hono').MiddlewareHandler;
