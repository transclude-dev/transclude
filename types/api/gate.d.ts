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
export declare function isGated(url: string, patterns?: string[]): boolean;
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
export declare function coversPattern(entry: string, pattern: string): boolean;
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
export declare function unmatched(gated: string[], { patterns, urls }: {
    patterns?: string[];
    urls?: string[];
}): string[];
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
export declare function readGated(gated: unknown): string[];
