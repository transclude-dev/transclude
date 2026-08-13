// Finding the schema for a record type.
//
// The recursion worth noticing before reading any of this: a lexicon is a
// record. It lives in somebody's repository, in the collection
// `com.atproto.lexicon.schema`, under its own NSID as the record key. So the
// schema view and the record view are the same view with a different renderer,
// and this file resolves through the chain in `identity.js` rather than beside
// it.
//
//   app.bsky.feed.post
//     -> authority is the namespace reversed: feed.bsky.app
//     -> _lexicon.feed.bsky.app  TXT  ->  did=did:plc:...
//     -> that DID's PDS
//     -> getRecord(com.atproto.lexicon.schema, rkey=app.bsky.feed.post)

import { nsidAuthorities } from './aturi.js';
import { TTL } from './cache.js';
import { didFromTxt, txt } from './dns.js';
import { pdsFrom, resolveDid } from './identity.js';
import { getRecord } from './xrpc.js';

/**
 * @typedef {object} Lexicon
 * @property {string} nsid
 * @property {string} did  Who published it.
 * @property {string} uri  The AT-URI of the schema record.
 * @property {string} cid
 * @property {object} schema  The lexicon document: `{ id, defs }`.
 */

/**
 * The lexicon for an NSID, or null if nobody published one.
 *
 * Null is an answer, not a failure. Most of this network's record types have no
 * published schema, and the renderer has a path for that. Throwing here would
 * turn a record that renders imperfectly into a page that does not render.
 *
 * @param {string} nsid
 * @param {import('./trace.js').Trace} trace
 * @returns {Promise<Lexicon|null>}
 */
export async function resolveLexicon(nsid, trace) {
  for (const domain of nsidAuthorities(nsid)) {
    const did = await authorityFor(domain, trace);
    if (!did) continue;

    // A domain can answer and still not hold the schema. `_lexicon.feed.bsky.app`
    // and `_lexicon.bsky.app` both answer for app.bsky.*, and they need not hold
    // the same records, so a miss here keeps walking up rather than giving up.
    const found = await read(nsid, did, trace);
    if (found) return found;
  }

  return null;
}

/** Who publishes for a domain, by DNS. */
async function authorityFor(domain, trace) {
  const records = await trace.step('DNS', `_lexicon.${domain}`, () => txt(`_lexicon.${domain}`, TTL.lexicon));
  return didFromTxt(records);
}

/** The schema record itself, or null if that repository does not hold it. */
async function read(nsid, did, trace) {
  try {
    const doc = await resolveDid(did, trace);
    const pds = pdsFrom(doc);
    const record = await getRecord(pds, did, 'com.atproto.lexicon.schema', nsid, trace);
    return { nsid, did, uri: record.uri, cid: record.cid, schema: record.value };
  } catch {
    return null;
  }
}

/**
 * The definition a record's fields come from. A record lexicon puts its object
 * under `defs.main.record`, which is one level deeper than every other def.
 *
 * @param {object|null} lexicon
 * @returns {object|null}
 */
export function recordDef(lexicon) {
  const main = lexicon?.schema?.defs?.main;
  if (main?.type !== 'record') return null;
  return main.record ?? null;
}

/**
 * Several lexicons at once, as a lookup keyed by NSID.
 *
 * A record's nested values name their own types, and rendering them properly
 * means having those schemas in hand. Resolving each one where it is met would
 * be a round trip per nested field per record. Resolving the distinct set once,
 * up front, is the same information for a fraction of the requests: a listing of
 * fifty posts needs the same three lexicons as one post.
 *
 * A name that resolves to nothing is left out rather than recorded as null. The
 * renderer treats absent and unpublished the same way, so there is nothing for
 * a second value to say.
 *
 * @param {string[]} nsids
 * @param {import('./trace.js').Trace} trace
 * @returns {Promise<Record<string, Lexicon>>}
 */
export async function resolveMany(nsids, trace) {
  const wanted = [...new Set(nsids)].filter(isResolvable);
  const found = await Promise.all(wanted.map((nsid) => resolveLexicon(nsid, trace).catch(() => null)));

  return Object.fromEntries(
    found.map((lexicon, index) => [wanted[index], lexicon]).filter(([, lexicon]) => lexicon !== null),
  );
}

const isResolvable = (nsid) => {
  try {
    return nsidAuthorities(nsid).length > 0;
  } catch {
    return false;
  }
};

/**
 * The def a `$type` or a `ref` names, from a lexicon already in hand.
 *
 * `app.bsky.embed.images` means the `main` def. `#link` and
 * `app.bsky.richtext.facet#link` both mean the def called `link`. A record def
 * keeps its object one level down, under `record`, and every other kind is the
 * object itself.
 *
 * @param {object|null} lexicon
 * @param {string} name  A `$type`, a ref, or a bare def name.
 * @returns {object|null}
 */
export function defIn(lexicon, name) {
  const fragment = String(name ?? '').split('#')[1] ?? 'main';
  const def = lexicon?.schema?.defs?.[fragment];
  if (!def) return null;
  return def.type === 'record' ? def.record ?? null : def;
}

/**
 * Follow a `ref` inside a lexicon. Only local refs resolve here: `#replyRef`
 * names a def in the same document and costs nothing.
 *
 * @param {string} ref
 * @param {object|null} lexicon
 * @returns {object|null}
 */
export function localDef(ref, lexicon) {
  if (typeof ref !== 'string' || !ref.startsWith('#')) return null;
  return defIn(lexicon, ref);
}

/**
 * Every NSID a lexicon points at, for the dependency links on a schema page.
 * Walks the whole document, because a ref can sit at any depth.
 *
 * @param {object|null} lexicon
 * @returns {string[]}
 */
export function referencedNsids(lexicon) {
  const found = new Set();

  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;

    for (const ref of [node.ref, ...(node.refs ?? [])]) {
      // A local ref names this document. Only the cross-document ones are
      // dependencies, and the def part after `#` is not part of the NSID.
      if (typeof ref === 'string' && !ref.startsWith('#')) found.add(ref.split('#')[0]);
    }

    Object.values(node).forEach(walk);
  };

  walk(lexicon?.schema?.defs);
  found.delete(lexicon?.nsid);
  return [...found].sort();
}
