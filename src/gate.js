// Paths an app says are not public, and whether a URL is one of them.
//
// Middleware does not run during a build, so nothing in `bin/build.js` can tell
// a payment gate or an auth check from an open page. `export const gated` in
// `app/server.js` is the only thing a build can read about a gate, and without
// it a gated page is written to `dist/static` and handed out by any static host,
// with the build reporting it as a page it prerendered.
//
// A layout guard is caught already, for a reason worth knowing: the build runs
// layout loaders, and a guard reads a cookie. Nothing runs `app/server.js` here.
//
// Pure. No `node:` imports: the sitemap reads this at runtime, on every runtime.
/**
 * Whether a URL is one the app declared not public.
 *
 * `export const gated` in `app/server.js` is the only thing a build can read
 * about a gate, because middleware does not run during one. A layout guard is
 * caught already: the build runs layout loaders and a guard reads a cookie. A
 * gate in `app/server.js` is run by nobody here, so a paid or signed-in page
 * with an ordinary loader is written to `dist/static` and handed out by any
 * static host, with the build reporting it as a success.
 *
 * `/premium` matches that path only. `/premium/*` matches it and everything
 * under it. Nothing else is a pattern: this decides whether to write a file, and
 * a rule nobody can read at a glance is the wrong shape for that.
 *
 * @param {string} url the path the build is about to write
 * @param {string[]} patterns
 * @returns {boolean}
 */
export function isGated(url, patterns = []) {
  return patterns.some((pattern) => {
    if (!pattern.endsWith('/*')) return url === pattern;
    const base = pattern.slice(0, -2);
    return url === base || url.startsWith(`${base}/`);
  });
}

/**
 * Whether an entry could gate some URL of a route.
 *
 * A pattern is Hono's spelling: `/notes/:id` takes one segment, and a brace
 * parameter like `/docs/:path{.+}` can take the rest of the path. This asks
 * about possibility, not fact: `/notes/secret` covers `/notes/:id` whether or
 * not `paths()` ever names it, and a brace parameter is taken to match
 * anything, so an unsure answer errs toward covered rather than refused.
 *
 * @param {string} entry one gated path
 * @param {string} pattern a route pattern
 * @returns {boolean}
 */
export function coversPattern(entry, pattern) {
  const rest = entry.endsWith('/*');
  const entrySegs = (rest ? entry.slice(0, -2) : entry).split('/').slice(1);
  const patternSegs = pattern.split('/').slice(1);

  for (let i = 0; i < patternSegs.length; i++) {
    // The entry ran out. `/api/*` still covers whatever follows; `/api` does not.
    if (i >= entrySegs.length) return rest;

    const seg = patternSegs[i];
    if (seg.startsWith(':')) {
      if (seg.includes('{')) return true;
      continue;
    }
    if (seg !== entrySegs[i]) return false;
  }

  // The pattern ran out. An entry asking for more segments than the route's
  // URLs have covers none of them.
  return rest || entrySegs.length === patternSegs.length;
}

/**
 * The gated entries that cover nothing.
 *
 * A typo in `gated` fails open: the entry matches nothing, the page it meant to
 * hold back is written, and the build reports a success. So the build asks
 * whether each entry could ever match, and refuses the ones that could not.
 *
 * @param {string[]} gated
 * @param {{ patterns?: string[], urls?: string[] }} site every route pattern,
 *   and every concrete URL the build knows: what `paths()` named, and the
 *   public files, which the gate also guards at runtime
 * @returns {string[]} the entries with nothing to cover
 */
export function unmatched(gated, { patterns = [], urls = [] }) {
  return gated.filter(
    (entry) =>
      !patterns.some((pattern) => coversPattern(entry, pattern)) &&
      !urls.some((url) => isGated(url, [entry])),
  );
}

/**
 * The declaration, or a refusal naming what is wrong with it.
 *
 * Checked rather than trusted, because a mistake here fails open: the page is
 * written, and the build says it prerendered a page that was supposed to need
 * paying for. This refuses the wrong shape. `unmatched` catches the typo that
 * is still a path.
 *
 * @param {unknown} gated whatever `app/server.js` exported
 * @returns {string[]}
 * @throws when it is not a list of paths
 */
export function readGated(gated) {
  if (gated === undefined || gated === null) return [];

  if (!Array.isArray(gated)) {
    throw new Error(
      `[transclude] app/server.js exports "gated" as ${typeof gated}. It is a list of paths, ` +
        `like ['/premium', '/api/*'].`,
    );
  }

  for (const entry of gated) {
    if (typeof entry !== 'string' || !entry.startsWith('/')) {
      throw new Error(
        `[transclude] "gated" in app/server.js has ${JSON.stringify(entry)}. ` +
          `Every entry is a path beginning with "/", and "/*" at the end covers what is under it.`,
      );
    }
  }

  return gated;
}
