// DNS over HTTPS.
//
// Two of the lookups this app makes are DNS TXT records: `_atproto` for a
// handle, `_lexicon` for a namespace. `node:dns` would do it, and would then be
// the one thing in the app that does not run on Workers.
//
// So: a GET, over `fetch`, to a resolver that answers in JSON. One code path,
// the same on Node, Bun, Deno and Workers, and no branch anywhere that says
// which runtime this is.

import { cached, TTL } from './cache.js';

/** RFC 8484's JSON form. Cloudflare and Google both serve it at this shape. */
const RESOLVER = 'https://cloudflare-dns.com/dns-query';

/**
 * Every TXT record at a name. Absent names and empty answers are both an empty
 * list: for this app "nobody published one" is an answer, not a failure.
 *
 * @param {string} name
 * @param {number} [ttl]
 * @returns {Promise<{ value: string[], cache: import('./trace.js').CacheState }>}
 */
export function txt(name, ttl = TTL.handle) {
  return cached(`txt:${name}`, ttl, async () => {
    const url = `${RESOLVER}?name=${encodeURIComponent(name)}&type=TXT`;
    const res = await fetch(url, { headers: { accept: 'application/dns-json' } });

    if (!res.ok) throw new Error(`The DNS resolver answered ${res.status} for ${name}.`);

    const body = await res.json();

    // Status 3 is NXDOMAIN: the name does not exist. That is the ordinary
    // answer for a handle that publishes no TXT record, and not an error.
    if (body.Status === 3) return [];
    if (body.Status !== 0) throw new Error(`DNS returned status ${body.Status} for ${name}.`);

    return (body.Answer ?? [])
      .filter((answer) => answer.type === 16)
      .map((answer) => unquote(answer.data));
  });
}

/**
 * A TXT record arrives quoted, and a long one arrives as several quoted strings
 * that are meant to be joined. Both are the resolver's encoding rather than the
 * value, so both come off here.
 *
 * @param {string} data
 */
const unquote = (data) =>
  String(data ?? '')
    .split(/"\s+"/)
    .join('')
    .replace(/^"|"$/g, '');

/**
 * The DID in a `did=` TXT record, or null. atproto puts one at `_atproto.<handle>`
 * for a handle and at `_lexicon.<domain>` for a namespace, in the same format.
 *
 * More than one `did=` record is a misconfiguration, and the spec says to treat
 * it as no answer rather than to pick. Picking would mean a name resolves to
 * different DIDs for different visitors.
 *
 * @param {string[]} records
 * @returns {string|null}
 */
export function didFromTxt(records) {
  const found = records.filter((record) => record.startsWith('did=')).map((record) => record.slice(4).trim());
  if (found.length !== 1) return null;
  return found[0];
}
