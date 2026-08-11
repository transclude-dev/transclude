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
 * The declaration, or a refusal naming what is wrong with it.
 *
 * Checked rather than trusted, because every mistake here fails open. A typo
 * matches nothing, the page is written, and the build says it prerendered a page
 * that was supposed to need paying for.
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
