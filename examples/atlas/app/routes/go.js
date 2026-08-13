// Where the box on the home page sends you.
//
// An endpoint rather than a loader on the home page, and the reason is the
// build: a loader that answers with a redirect is different for each visitor,
// so the home page could not be written to a file. This way it still is, and
// the one dynamic thing about it lives in its own route.
//
// The classification is deliberately shallow. Everything goes to `/at/`, which
// resolves a handle or a DID and says plainly when it cannot. Guessing harder
// here would put a second copy of the rules in `aturi.js` next to the first,
// and the two would drift.

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
export const GET = ({ url }) => {
  const asked = (new URL(url).searchParams.get('q') ?? '').trim().replace(/^@/, '');
  const path = asked.startsWith('at://') ? asked.slice(5) : asked;

  if (!SAFE.test(path)) return seeOther('/');

  return seeOther(`/at/${path}`);
};
