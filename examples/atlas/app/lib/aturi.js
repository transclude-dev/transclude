// AT-URIs and NSIDs, as strings. Nothing here touches the network, so this is
// the file to read first and the file the tests cover hardest.
//
// An AT-URI names one thing on the network:
//
//   at://did:plc:abc/app.bsky.feed.post/3k2j
//        authority    collection         rkey
//
// The authority is a DID or a handle. Both later parts are optional, so one
// URI shape covers a repository, a collection in it, and a single record.

/**
 * @typedef {object} AtUri
 * @property {string} authority  A DID or a handle. Always present.
 * @property {string|null} collection  An NSID, or null for a whole repository.
 * @property {string|null} rkey  A record key, or null for a whole collection.
 * @property {string} href  The path this app serves it at.
 * @property {string} uri  The canonical `at://` form.
 */

/**
 * Read an AT-URI. The `at://` prefix is optional, because the path form this
 * app uses drops it: `/at/did:plc:abc/app.bsky.feed.post/3k2j`.
 *
 * @param {string} input
 * @returns {AtUri}
 */
export function parseAtUri(input) {
  const trimmed = String(input ?? '').trim();
  const body = trimmed.startsWith('at://') ? trimmed.slice(5) : trimmed;
  const segments = body.split('/').filter(Boolean);

  const [authority, collection = null, rkey = null] = segments;

  if (!authority) throw new Error('An AT-URI needs an authority: a DID or a handle.');
  if (segments.length > 3) throw new Error(`An AT-URI has at most three parts. "${trimmed}" has ${segments.length}.`);
  if (collection && !isNsid(collection)) throw new Error(`"${collection}" is not an NSID, so it cannot be a collection.`);

  return {
    authority,
    collection,
    rkey,
    href: `/at/${segments.join('/')}`,
    uri: `at://${segments.join('/')}`,
  };
}

/** What an AT-URI points at. The three cases the record view switches on. */
export const kindOf = (parsed) => {
  if (parsed.rkey) return 'record';
  if (parsed.collection) return 'collection';
  return 'repo';
};

/** @param {string} value */
export const isDid = (value) => /^did:[a-z]+:/.test(String(value ?? ''));

/**
 * An NSID is a reversed domain plus a name: `app.bsky.feed.post`. Three
 * segments at least, because a domain needs two and the name needs one.
 *
 * @param {string} value
 */
export function isNsid(value) {
  const segments = String(value ?? '').split('.');
  if (segments.length < 3) return false;

  const domain = segments.slice(0, -1);
  const name = segments[segments.length - 1];

  // A domain label: letters, digits, and hyphens that are not on either end.
  const label = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/;
  if (!domain.every((segment) => label.test(segment))) return false;

  // The first label is a TLD written backwards, so it never starts with a digit.
  if (/^[0-9]/.test(domain[0])) return false;

  // The name is the one segment that is not a domain label. Letters only, which
  // is what separates `app.bsky.feed.post` from the handle `ada.bsky.social`.
  return /^[a-zA-Z]+$/.test(name);
}

/**
 * The domain that answers for an NSID. Every segment except the name, reversed.
 * `app.bsky.feed.post` is published by whoever controls `feed.bsky.app`.
 *
 * @param {string} nsid
 * @returns {string}
 */
export function nsidAuthority(nsid) {
  if (!isNsid(nsid)) throw new Error(`"${nsid}" is not an NSID.`);
  return nsid.split('.').slice(0, -1).reverse().join('.');
}

/**
 * Every domain that may answer for an NSID, most specific first. Resolution
 * walks up: `feed.bsky.app` answers for `app.bsky.feed.post`, and so does
 * `bsky.app`. Both are published in practice, and they need not agree, so the
 * order is the rule and not a preference.
 *
 * @param {string} nsid
 * @returns {string[]}
 */
export function nsidAuthorities(nsid) {
  const labels = nsidAuthority(nsid).split('.');
  const domains = [];
  // Stop at two labels. A single label is a TLD and answers for nobody.
  for (let i = 0; i <= labels.length - 2; i++) domains.push(labels.slice(i).join('.'));
  return domains;
}

/** The path this app serves a DID or handle at. */
export const identityHref = (authority) => `/did/${authority}`;

/** The path this app serves a lexicon at. */
export const lexiconHref = (nsid) => `/lexicon/${nsid}`;
