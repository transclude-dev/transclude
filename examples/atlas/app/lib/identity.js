// The resolution chain. Everything else in this app is a view over it.
//
//   handle ──> DID ──> DID document ──> PDS
//
// Each arrow is a hop, each hop is cached and traced, and the last one is what
// a page needs before it can ask for anything. Read this file and you know what
// the trace rail is showing you.
//
// The one thing worth saying twice: a handle and a DID have to agree in both
// directions. A DID document can claim any handle at all. Only the handle's own
// DNS or web server can confirm it, and this app marks the difference rather
// than hiding it.

import { cached, TTL } from './cache.js';
import { didFromTxt, txt } from './dns.js';
import { isDid } from './aturi.js';

/**
 * @typedef {object} Identity
 * @property {string} did
 * @property {string|null} handle  What the DID document claims, or what was asked for.
 * @property {boolean} verified  Whether the handle and the DID confirm each other.
 * @property {string} pds  The base URL of the personal data server.
 * @property {object} doc  The DID document.
 */

/**
 * A handle to a DID. Two methods, in the order the spec puts them.
 *
 * The well-known lookup is not a fallback for a failed DNS lookup. It is the
 * method for handles that never had a TXT record, which is most handles hosted
 * by somebody else.
 *
 * @param {string} handle
 * @param {import('./trace.js').Trace} trace
 * @returns {Promise<string>}
 */
export async function resolveHandle(handle, trace) {
  const records = await trace.step('DNS', `_atproto.${handle}`, () => txt(`_atproto.${handle}`));
  const fromDns = didFromTxt(records);
  if (fromDns) return fromDns;

  const fromWeb = await trace.step('Well-known', `${handle}/.well-known/atproto-did`, () =>
    cached(`well-known:${handle}`, TTL.handle, async () => {
      const res = await fetch(`https://${handle}/.well-known/atproto-did`);
      if (!res.ok) return null;
      const body = (await res.text()).trim();
      return isDid(body) ? body : null;
    }),
  );

  if (!fromWeb) throw new Error(`"${handle}" publishes no DID, by DNS or at /.well-known/atproto-did.`);
  return fromWeb;
}

/**
 * A DID to its document. Two methods, and which one is used is decided by the
 * DID itself rather than by configuration.
 *
 * @param {string} did
 * @param {import('./trace.js').Trace} trace
 * @returns {Promise<object>}
 */
export async function resolveDid(did, trace) {
  if (did.startsWith('did:plc:')) {
    return trace.step('PLC directory', `plc.directory/${did}`, () =>
      cached(`did:${did}`, TTL.did, () => getJson(`https://plc.directory/${did}`, `No PLC entry for ${did}.`)),
    );
  }

  if (did.startsWith('did:web:')) {
    const url = didWebUrl(did);
    return trace.step('did:web', url, () =>
      cached(`did:${did}`, TTL.did, () => getJson(url, `No document at ${url}.`)),
    );
  }

  throw new Error(`${did} uses a DID method this app cannot resolve. It reads did:plc and did:web.`);
}

/**
 * Where a did:web document lives. The identifier's colons are path separators
 * after the domain, so `did:web:example.com:u:ada` is `/u/ada/did.json`.
 *
 * @param {string} did
 */
export function didWebUrl(did) {
  const [domain, ...path] = did.slice('did:web:'.length).split(':');
  if (!domain) throw new Error(`${did} names no domain.`);
  const host = decodeURIComponent(domain);
  if (path.length === 0) return `https://${host}/.well-known/did.json`;
  return `https://${host}/${path.map(decodeURIComponent).join('/')}/did.json`;
}

/**
 * The personal data server named in a DID document. This is the only entry in
 * the document this app needs, and a document without it belongs to an identity
 * with nothing to read.
 *
 * @param {object} doc
 * @returns {string}
 */
export function pdsFrom(doc) {
  const services = Array.isArray(doc?.service) ? doc.service : [];
  const pds = services.find((service) => service?.type === 'AtprotoPersonalDataServer');
  if (!pds?.serviceEndpoint) throw new Error('This DID document names no personal data server.');
  return String(pds.serviceEndpoint).replace(/\/$/, '');
}

/**
 * The handle a DID document claims. A claim and nothing more until the handle
 * itself confirms it.
 *
 * @param {object} doc
 * @returns {string|null}
 */
export function claimedHandle(doc) {
  const names = Array.isArray(doc?.alsoKnownAs) ? doc.alsoKnownAs : [];
  const first = names.find((name) => String(name).startsWith('at://'));
  return first ? String(first).slice(5) : null;
}

/**
 * The whole chain, from whatever the visitor typed.
 *
 * Verification runs in whichever direction the input did not come from, so both
 * inputs cost the same two lookups and reach the same answer. A handle that
 * does not confirm is still resolved and still rendered. It is labeled instead,
 * because refusing to show it would hide the more interesting case.
 *
 * @param {string} input  A handle or a DID.
 * @param {import('./trace.js').Trace} trace
 * @returns {Promise<Identity>}
 */
export async function resolveIdentity(input, trace) {
  const asked = String(input ?? '').trim().replace(/^@/, '');
  if (!asked) throw new Error('Nothing to resolve.');

  const did = isDid(asked) ? asked : await resolveHandle(asked, trace);
  const doc = await resolveDid(did, trace);
  const pds = pdsFrom(doc);
  const claimed = claimedHandle(doc);

  if (isDid(asked)) {
    // Asked by DID. The document claims a handle; ask that handle who it is.
    const verified = claimed ? await confirms(claimed, did, trace) : false;
    return { did, handle: claimed, verified, pds, doc };
  }

  // Asked by handle, and the handle already led here. The document confirms it
  // by claiming the same name back.
  return { did, handle: asked, verified: claimed === asked, pds, doc };
}

/**
 * Whether a handle resolves to the DID that claims it. A handle that fails to
 * resolve at all is unconfirmed rather than an error: the identity is fine, the
 * name on it is what is in doubt.
 */
async function confirms(handle, did, trace) {
  try {
    return (await resolveHandle(handle, trace)) === did;
  } catch {
    return false;
  }
}

/** @param {string} url @param {string} missing */
async function getJson(url, missing) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (res.status === 404) throw new Error(missing);
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}.`);
  return res.json();
}
