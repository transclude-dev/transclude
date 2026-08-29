/**
 * An IPv4 address as four numbers, or null if the text is not one.
 *
 * @param {string} text
 * @returns {number[]|null} four octets, or null when it is not one
 */
export declare function parseV4(text: string): number[] | null;
/**
 * An IPv6 address as eight groups, or null.
 *
 * Only enough of the format to classify one. An address with a trailing IPv4
 * part is handled, because `::ffff:169.254.169.254` is the obvious way around a
 * checker that only reads the hex form.
 *
 * @param {string} text
 * @returns {number[]|null} sixteen bytes, or null
 */
export declare function parseV6(text: string): number[] | null;
/**
 * Why this address may not be fetched from, or null if it may.
 *
 * Takes the text of a host, with no brackets. A name that is not an address
 * returns null: whether a *name* is allowed is the allowlist's question, and
 * where it resolves to is the runtime's.
 *
 * @param {string} host a literal address, not a name
 * @returns {string|null} why it is refused, or null when it is allowed
 */
export declare function blockedAddress(host: string): string | null;
/**
 * Whether a hostname is one the config named.
 *
 * Default deny. An entry is an exact hostname, or `*.example.com`, which covers
 * any subdomain but not the bare domain: naming a wildcard should not quietly
 * hand over the apex too.
 *
 * @param {string} host
 * @param {string[]} [allow] names, and `*.` wildcards
 * @returns {boolean} false unless something on the list names it
 */
export declare function allowedHost(host: string, allow?: string[]): boolean;
/**
 * The one place a URL is judged before anything connects.
 *
 * Order matters. The allowlist is checked before the address, so a host nobody
 * permitted is refused without this having formed an opinion about where it
 * points.
 *
 * @param {string} url
 * @param {{ allow?: string[] }} [options]
 * @returns {string|null} why it is refused, or null when it may be fetched
 */
export declare function checkUrl(url: string, { allow }?: {
    allow?: string[];
}): string | null;
