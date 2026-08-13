// Who else is out there. Two services, and neither of them is the network.
//
// Everything else in this app reads the AT Protocol directly: a DID document
// from the directory that holds it, a record from the server that holds it.
// Nothing here can be checked that way. "How many records point at this one" is
// not a question any one repository can answer, because the answer is spread
// across every repository there is.
//
// So this file talks to two indexes that did the crawling:
//
//   a relay        which repositories carry a given collection
//   Constellation  which records point at a given target
//
// They are somebody else's view of the network, they can be stale, and they can
// be wrong. Both appear in the trace under their own names for exactly that
// reason: a reader can see which numbers on a page came from an index rather
// than from the thing itself.
//
// Both are optional. A page that cannot reach them renders without them.

import { cached, TTL } from './cache.js';

/** A relay sees every repository on the network and indexes what they hold. */
const RELAY = 'https://relay1.us-east.bsky.network';

/** Constellation is a backlink index. https://constellation.microcosm.blue */
const CONSTELLATION = 'https://constellation.microcosm.blue';

/**
 * Repositories that carry a collection. This is what makes a schema page a map
 * rather than a definition: a lexicon nobody uses and a lexicon with forty
 * thousand users look the same until somebody counts.
 *
 * @param {string} collection  An NSID.
 * @param {number} limit
 * @param {import('./trace.js').Trace} trace
 * @returns {Promise<string[]>}  DIDs.
 */
export async function reposUsing(collection, limit, trace) {
  try {
    const body = await trace.step('Relay', `${host(RELAY)}/listReposByCollection`, () =>
      cached(`repos:${collection}:${limit}`, TTL.discovery, () =>
        getJson(`${RELAY}/xrpc/com.atproto.sync.listReposByCollection?collection=${encodeURIComponent(collection)}&limit=${limit}`),
      ),
    );

    return (body.repos ?? []).map((repo) => repo.did).filter(Boolean);
  } catch {
    // An index being down is not a reason to fail a schema page. The trace
    // already recorded what happened.
    return [];
  }
}

/**
 * @typedef {object} Backlink
 * @property {string} collection  The record type that points here.
 * @property {string} path  Which field in it does the pointing.
 * @property {number} count
 * @property {string} href  The lexicon page for that collection.
 */

/**
 * What points at something, by record type. The target is a DID or an AT-URI,
 * and which one matters: a follow points at a DID, a like points at a post's
 * AT-URI, and asking with the wrong one returns nothing rather than an error.
 *
 * @param {string} target
 * @param {import('./trace.js').Trace} trace
 * @returns {Promise<Backlink[]>}
 */
export async function backlinks(target, trace) {
  try {
    const body = await trace.step('Constellation', `${host(CONSTELLATION)}/links/all/count`, () =>
      cached(`links:${target}`, TTL.discovery, () =>
        getJson(`${CONSTELLATION}/links/all/count?target=${encodeURIComponent(target)}`),
      ),
    );

    return Object.entries(body.links ?? {})
      .flatMap(([collection, paths]) =>
        Object.entries(paths ?? {}).map(([path, count]) => ({
          collection,
          path,
          count: Number(count) || 0,
          href: `/lexicon/${collection}`,
        })),
      )
      .filter((link) => link.count > 0)
      .sort((a, b) => b.count - a.count);
  } catch {
    return [];
  }
}

/**
 * The records themselves, for one kind of backlink. Paged the index's own way,
 * because the cursor is opaque and a second paging scheme over it would
 * disagree with the first.
 *
 * @param {string} target
 * @param {{ collection: string, path: string, cursor?: string, limit?: number }} which
 * @param {import('./trace.js').Trace} trace
 */
export async function linkingRecords(target, which, trace) {
  const { collection, path, cursor, limit = 25 } = which;

  try {
    const url = new URL(`${CONSTELLATION}/links`);
    url.searchParams.set('target', target);
    url.searchParams.set('collection', collection);
    url.searchParams.set('path', path);
    url.searchParams.set('limit', String(limit));
    if (cursor) url.searchParams.set('cursor', cursor);

    const body = await trace.step('Constellation', `${host(CONSTELLATION)}/links`, () =>
      cached(`linking:${target}:${collection}:${path}:${cursor ?? ''}`, TTL.discovery, () => getJson(url.toString())),
    );

    return {
      total: Number(body.total) || 0,
      cursor: body.cursor ?? null,
      records: (body.linking_records ?? []).map((record) => ({
        did: record.did,
        collection: record.collection,
        rkey: record.rkey,
        href: `/at/${record.did}/${record.collection}/${record.rkey}`,
      })),
    };
  } catch {
    return { total: 0, cursor: null, records: [] };
  }
}

const host = (base) => new URL(base).host;

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}.`);
  return res.json();
}
