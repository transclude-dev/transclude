/**
 * Picks a content encoding from an Accept-Encoding header.
 *
 * Getting this wrong is not a missed optimization, it is a corrupt response: a
 * client that did not ask for brotli must never be handed brotli. So the rules
 * are followed properly: q-values, `*`, and `q=0` as a refusal.
 *
 * @param {string|null|undefined} header the request's Accept-Encoding
 * @param {string[]} available encodings this response actually has
 * @returns {string|null} null means send it unencoded
 */
export declare function pickEncoding(header: string | null | undefined, available?: string[]): string | null;
/**
 * Whether an unencoded response is still allowed.
 *
 * A client can refuse identity with `identity;q=0`, and then a body we have no
 * encoding for cannot be sent at all.
 *
 * @param {string|null|undefined} header
 * @returns {boolean}
 */
export declare function identityAcceptable(header: string | null | undefined): boolean;
