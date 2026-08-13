// Where the box on the home page sends you.
//
// An endpoint rather than a loader on the home page, and the reason is the
// build: a loader that answers with a redirect is different for each visitor,
// so the home page could not be written to a file. This way it still is, and
// the one dynamic thing about it lives in its own route.

import { isDid, isNsid } from '../lib/aturi.js';
import { resolveHandle } from '../lib/identity.js';
import { createTrace } from '../lib/trace.js';

/**
 * What may appear in an AT-URI: a handle, a DID, an NSID, a record key. Nothing
 * else reaches the redirect.
 *
 * This is a header value, so the check is not about tidiness. A carriage return
 * in the query would end the header and start writing the next one.
 */
const SAFE = /^[A-Za-z0-9._:~%-]+(?:\/[A-Za-z0-9._:~%-]+)*$/;

const seeOther = (location) => new Response(null, { status: 303, headers: { location } });

/** @param {{ url: string }} ctx */
export const GET = async ({ url }) => {
  const asked = (new URL(url).searchParams.get('q') ?? '').trim().replace(/^@/, '');
  const path = asked.startsWith('at://') ? asked.slice(5) : asked;

  if (!SAFE.test(path)) return seeOther('/');

  // A DID, or anything with more than one part, is already unambiguous.
  if (isDid(path) || path.includes('/')) return seeOther(`/at/${path}`);

  // Anything that cannot be an NSID is a handle by elimination.
  if (!isNsid(path)) return seeOther(`/at/${path}`);

  // What is left is genuinely ambiguous, and no amount of reading the string
  // settles it: `ada.bsky.social` and `app.bsky.feed.post` have the same shape.
  // A handle resolves and a namespace does not, so the network decides.
  try {
    await resolveHandle(path, createTrace());
    return seeOther(`/at/${path}`);
  } catch {
    return seeOther(`/lexicon/${path}`);
  }
};
