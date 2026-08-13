// The three calls this app makes to a personal data server.
//
// All three are unauthenticated, and that is the point worth noticing: a
// repository on this network is readable by anybody with its address. There is
// no SDK here and no token. A GET, a query string, and JSON back.

import { cached, TTL } from './cache.js';

/**
 * @param {string} pds  The base URL from the DID document.
 * @param {string} method  An NSID, like `com.atproto.repo.getRecord`.
 * @param {Record<string, string|number|undefined>} params
 */
async function xrpc(pds, method, params) {
  const url = new URL(`/xrpc/${method}`, pds);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }

  const res = await fetch(url, { headers: { accept: 'application/json' } });

  if (!res.ok) {
    // A PDS says why in the body, and its reason is better than any sentence
    // written here. `RecordNotFound` and `CouldNotFindRepo` both arrive as 400.
    const body = await res.json().catch(() => null);
    const reason = body?.message || body?.error || `${res.status}`;
    throw new Error(`${new URL(pds).host} refused ${method}: ${reason}`);
  }

  return res.json();
}

/** The URL a call would go to. The trace shows this, so the reader can repeat it. */
export const xrpcUrl = (pds, method) => `${new URL(pds).host}/xrpc/${method}`;

/**
 * What a repository holds. The collections list is how the identity view knows
 * what to offer, and it is the one call that needs nothing but a DID.
 *
 * @param {string} pds
 * @param {string} did
 * @param {import('./trace.js').Trace} trace
 */
export function describeRepo(pds, did, trace) {
  return trace.step('PDS', xrpcUrl(pds, 'com.atproto.repo.describeRepo'), () =>
    cached(`repo:${did}`, TTL.record, () => xrpc(pds, 'com.atproto.repo.describeRepo', { repo: did })),
  );
}

/**
 * One page of a collection. The cursor is the PDS's, passed through untouched:
 * it is opaque, and inventing a page number over it would be a second paging
 * scheme that disagrees with the first.
 *
 * @param {string} pds
 * @param {string} did
 * @param {string} collection
 * @param {{ limit?: number, cursor?: string }} [page]
 * @param {import('./trace.js').Trace} trace
 */
export function listRecords(pds, did, collection, page, trace) {
  const { limit = 50, cursor } = page ?? {};
  return trace.step('PDS', xrpcUrl(pds, 'com.atproto.repo.listRecords'), () =>
    cached(`list:${did}:${collection}:${cursor ?? ''}:${limit}`, TTL.record, () =>
      xrpc(pds, 'com.atproto.repo.listRecords', { repo: did, collection, limit, cursor }),
    ),
  );
}

/**
 * One record. The lexicon view uses this too, because a lexicon is a record
 * like any other and this app has no second way to read one.
 *
 * @param {string} pds
 * @param {string} did
 * @param {string} collection
 * @param {string} rkey
 * @param {import('./trace.js').Trace} trace
 */
export function getRecord(pds, did, collection, rkey, trace) {
  return trace.step('PDS', xrpcUrl(pds, 'com.atproto.repo.getRecord'), () =>
    cached(`record:${did}:${collection}:${rkey}`, TTL.record, () =>
      xrpc(pds, 'com.atproto.repo.getRecord', { repo: did, collection, rkey }),
    ),
  );
}
