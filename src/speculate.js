// What the browser may fetch, or run, before the reader clicks.
//
// This framework ships no client router: every link is a document request. That
// is the whole bet, and the cost of it is one round trip per navigation.
// Speculation rules are the platform's answer, and they cost no JavaScript of
// ours: a JSON block in the head, and the browser decides.
//
// The part worth writing down is what must *not* be speculated. A prerender
// runs the page. A route this build wrote to a file has no loader left to run,
// so prerendering it is free and safe. Everything else is a server render whose
// loader may read a cookie, count a view or hand out a one-time token, and
// prerendering that for a reader who never clicked is wrong rather than slow.
// The build knows which is which. A hand-written rules block does not.
//
// No `node:` imports. The build calls this with the lists it already holds.

/** What the spec allows, so a typo is caught here rather than ignored by Chrome. */
const EAGERNESS = new Set(['immediate', 'eager', 'moderate', 'conservative']);

/**
 * A route pattern as something `href_matches` understands.
 *
 * Hono writes `/docs/:path{.+}` and `/people/:name`. Both become `*`: the regex
 * half is Hono's own spelling and means nothing to a URL pattern, and a rule
 * that matches too little is a missed prefetch while one that matches too much
 * speculates a URL that 404s.
 *
 * @param {string} pattern
 * @returns {string}
 */
export function hrefPattern(pattern) {
  return pattern.replace(/:[A-Za-z0-9_]+(\{[^}]*\})?/g, '*');
}

/** `{ href_matches }` for each, or null when there is nothing to match. */
function where(patterns) {
  if (!patterns.length) return null;
  return { or: patterns.map((pattern) => ({ href_matches: pattern })) };
}

/**
 * The `<script type="speculationrules">` body for a site, or null.
 *
 * Two lists, because they are two different promises. `prerendered` is every URL
 * written to a file, and the browser may run those. `dynamic` is every route the
 * server still renders, and the browser may only fetch those: the response is
 * the same document a click would have got, and no page script runs early.
 *
 * Endpoints are in neither. A `.js` route answers with whatever it builds, and
 * speculating one spends a request on something no navigation will reuse.
 *
 * @param {object} site
 * @param {string[]} [site.prerendered] URLs written to a file
 * @param {string[]} [site.dynamic] route patterns the server renders
 * @param {object} [options]
 * @param {string[]} [options.exclude] patterns to leave out of both
 * @param {string} [options.eagerness] how soon the browser may act
 * @returns {string|null} JSON, or null when nothing is speculated
 * @throws when `eagerness` is not one the spec names
 */
export function speculationRules({ prerendered = [], dynamic = [] }, options = {}) {
  const { exclude = [], eagerness = 'moderate' } = options;

  if (!EAGERNESS.has(eagerness)) {
    throw new Error(
      `[transclude] speculate.eagerness is ${JSON.stringify(eagerness)}. ` +
        `It is one of ${[...EAGERNESS].join(', ')}.`,
    );
  }

  const excluded = new Set(exclude);
  const keep = (pattern) => !excluded.has(pattern);

  // Sorted and deduplicated, so two builds of one site produce the same bytes
  // and the CSP hash of this block does not change for no reason.
  const clean = (list) => [...new Set(list)].filter(keep).sort();

  const rules = {};
  // A prerendered URL is already a URL. A route is a pattern, and `exclude` is
  // matched against what comes out, so what an author writes is what they read
  // in the emitted rules.
  const run = where(clean(prerendered));
  const fetchOnly = where(clean(dynamic.map(hrefPattern)));

  if (run) rules.prerender = [{ where: run, eagerness }];
  if (fetchOnly) rules.prefetch = [{ where: fetchOnly, eagerness }];

  return run || fetchOnly ? JSON.stringify(rules) : null;
}

/**
 * `speculate` as `{ exclude, eagerness }`, or null for off.
 *
 * Off by default, like every other thing here that changes what a browser is
 * told to do. `true` is the defaults.
 *
 * @param {boolean|object} [setting]
 * @returns {object|null}
 */
export function speculateSettings(setting) {
  if (!setting) return null;
  return setting === true ? {} : setting;
}
