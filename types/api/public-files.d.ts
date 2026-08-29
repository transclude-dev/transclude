/**
 * A handler for `publicFiles`, with a validator, a type and a 304.
 *
 * `serveStatic` sets the headers and reads no request condition, so the
 * conditional half is done around it. The file it found is the one measured,
 * which is the point when `precompressed` served a `.br`: different bytes are
 * a different entity and must not share an ETag.
 *
 * @param {string} root relative to the working directory
 * @returns {Function} Hono middleware
 */
export declare function publicFiles(root: string): Function;
