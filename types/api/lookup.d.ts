/**
 * A `lookup` for the proxy: the reason a host may not be fetched, or null.
 *
 * Every address a name resolves to is checked, not just the first. A name that
 * answers with one public address and one private one is a way in, and which of
 * the two a connection uses is not ours to decide.
 *
 * This still leaves a gap that no amount of checking here closes: the name is
 * resolved once for the check and again by the connection, and a record whose
 * TTL expires in between can change. The allowlist is what actually holds, and
 * this is defense behind it.
 *
 * @param {{ resolver?: { lookup: (hostname: string, options: { all: true })
 *   => Promise<Array<{ address: string }>> } }} [deps] injected so a test needs no DNS
 * @returns {(hostname: string) => Promise<string|null>} why the name is refused, or null
 */
export declare function nodeLookup({ resolver }?: {
    resolver?: {
        lookup: (hostname: string, options: {
            all: true;
        }) => Promise<Array<{
            address: string;
        }>>;
    };
}): (hostname: string) => Promise<string | null>;
