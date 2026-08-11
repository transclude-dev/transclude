// Resolving a hostname, which is the one check the core cannot make.
//
// `src/address.js` decides what an address means and imports nothing. This
// turns a name into addresses, which needs the runtime: Node and Deno have a
// resolver, and workerd has none at all.
//
// Not reachable from `src/app.js`. It is passed in by the servers that can
// supply it, and left out by the one that cannot.

import { promises as dns } from 'node:dns';

import { blockedAddress } from './address.js';

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
 * this is defence behind it.
 *
 * @param {{ resolver?: object }} [deps] injected so a test needs no DNS
 * @returns {(hostname: string) => Promise<string[]>} every address the name answers with
 */
export function nodeLookup({ resolver = dns } = {}) {
  return async (hostname) => {
    // A literal is already decided by `checkUrl`, which runs before this.
    if (blockedAddress(hostname)) return blockedAddress(hostname);

    let addresses;
    try {
      addresses = await resolver.lookup(hostname, { all: true });
    } catch {
      // A name that does not resolve is not this check's refusal to make. The
      // fetch will fail on its own and say so in its own words.
      return null;
    }

    for (const { address } of addresses) {
      const why = blockedAddress(address);
      if (why) return `${address}, which is ${why}`;
    }
    return null;
  };
}
