// What a `<transclude>` is resolved against, built once.
//
// Three servers render pages: the production app, the dev server and the build.
// Each used to be handed a piece of this and the dev server was handed less than
// the others, so an include that worked in production threw in dev with nothing
// to suggest why. One function answers it for all three.

import { loadFragment, paramsFor, regionOf, renderLoaded } from './document.js';
import { includeResolver } from './proxy.js';

/**
 * `{ resolve, route }` for `renderRoute`.
 *
 * `resolve` reads another site and needs `proxy.allow`; without it an external
 * include says so. `route` reads another route of this app and needs nothing,
 * because nothing leaves the server.
 *
 * @param routes  the route table, as `{ id, pattern }`
 * @param pageFor a route id to its compiled module, possibly a promise
 */
export function includeContext({ config, routes = [], pageFor, lookup = null }) {
  // An empty `allow` is no proxy. A resolver built with it would refuse every
  // host as one nobody allowed, which is true and names the wrong fix:
  // `resolveIncludes` says to name one in `proxy.allow`.
  const foreign = config.proxy?.allow?.length
    ? includeResolver(config.proxy, { lookup: config.proxy.lookup ?? lookup ?? null })
    : null;

  const context = {
    resolve: foreign?.resolve ?? null,

    route: async (path, id, ctx, options) => {
      const url = new URL(path, ctx.url);
      const found = routeFor(url.pathname);
      if (!found) throw new Error(`[transclude] no route answers ${path}`);

      const chain = options?.includeChain ?? [];
      const key = keyOf(url);
      refuseLoop(options?.includeMemo, parentOf(chain, ctx.url), key);

      const page = await pageFor(found.route.id);
      if (!page) throw new Error(`[transclude] ${path} is not a page`);

      // Before the loaders, which would run for nothing. A route's fragments
      // are fixed when it compiles, since one may not sit under an `if`, so a
      // name it does not have is a typo, the same as `#nope` on this page.
      const target = regionOf(page, id);
      if (!target) {
        const src = chain.at(-1) ?? `${path}#${id}`;
        throw new Error(
          `[transclude] <transclude src="${src}"> names no fragment of ${path}. ` +
            `A fragment is an element with an id and a "fragment" attribute.`,
        );
      }

      const data = await loadOnce(key, url, found, page, ctx, options);
      if (data instanceof Response) return null;
      return renderLoaded(page, data, target);
    },
  };

  /**
   * The route a request for this path would reach, and its params.
   *
   * `/notes/` is `/notes`, as it is for a request: the server redirects one to
   * the other, or with `trailingSlash: 'ignore'` answers both. The root keeps
   * its slash.
   */
  function routeFor(pathname) {
    const path = withoutTrailingSlash(pathname);
    for (const route of routes) {
      const params = paramsFor(route, path);
      if (params) return { route, params };
    }
    return null;
  }

  /**
   * A route's loaders, run once per request however many of its fragments the
   * page includes, so every one of them renders from the same data. Keyed by
   * `keyOf`, and held as the promise: includes that start together still share
   * one run. A loader that answers with a `Response` is held as one too, and
   * the include falls back: the page asked for markup, not for a redirect.
   */
  function loadOnce(key, url, found, page, ctx, options) {
    const memo = options?.includeMemo;
    if (memo?.has(key)) return memo.get(key);

    const loading = load(url, found, page, ctx, options);
    memo?.set(key, loading);
    return loading;
  }

  /**
   * Rendered rather than fetched. It is the same process, so a request to
   * ourselves would run the whole middleware stack to answer something we can
   * answer directly, and would need a URL the server may not know behind a
   * proxy.
   *
   * The host's `ctx` goes through, cookies and all. That is what makes reading
   * contagious: a page including a route whose loader reads a cookie is personal
   * too, and the cache has to know.
   */
  function load(url, found, page, ctx, options) {
    return loadFragment(
      page,
      {
        ...ctx,
        url: url.href,
        params: found.params,
        route: { id: found.route.id, pattern: found.route.pattern, path: url.pathname },
        // The include is not the request. A loader that branches on the region
        // asked for should see this render for what it is. And one load serves
        // every fragment of this route the page includes, so one name would be
        // wrong for the others.
        fragment: null,
        action: null,
      },
      { ...options, include: context },
    );
  }

  return context;
}

/** `/notes/` is `/notes`. The root keeps its slash. */
function withoutTrailingSlash(pathname) {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
  return pathname;
}

/**
 * One load of a route: the path and the query, without the slash at the end.
 * The memo is keyed by it, and so is the loop check, because a loop is a load
 * that waits on itself.
 *
 * @param {URL} url
 */
function keyOf(url) {
  return withoutTrailingSlash(url.pathname) + url.search;
}

/**
 * The load this include runs inside, or null at the page itself.
 *
 * The chain holds every `src` above this include, and the last one is its
 * own. The one before it, when it names a route, is the load whose page holds
 * this include.
 *
 * @param {string[]} chain
 * @param {string} base the request URL, to read a `src` against
 */
function parentOf(chain, base) {
  const src = chain.at(-2);
  if (!src?.startsWith('/')) return null;
  return keyOf(new URL(src.split('#')[0], base));
}

/** Per request, which load includes which. Keyed by the request's memo. */
const includesByMemo = new WeakMap();

/**
 * Throws when this include would close a loop of loads.
 *
 * `resolveIncludes` refuses a `src` it has already seen. That misses a loop
 * that comes back by another fragment: loading a route resolves every include
 * on it, not only those inside the fragment asked for, so `/y#a` reaching
 * `/z#c` reaching `/y#d` loads `/y` inside its own load. The memo then hands
 * back the promise still waiting on itself. Nothing threw, and the request
 * never answered.
 *
 * A check of the chain is not enough either. A page that includes `/y` and
 * `/z`, each including the other, starts both loads at once, and each finds
 * the other's promise in the memo. Neither chain repeats. So each include
 * records an edge from the load it runs inside to the load it asks for, and
 * an edge that closes a loop is refused before anything waits on it.
 *
 * A page's includes are fixed when it compiles, so an edge is a fact about
 * the app, not about timing, and edges are never removed.
 *
 * @param {Map<string, unknown>|undefined} memo the request's, or none
 * @param {string|null} from the load this include runs inside
 * @param {string} to the load it asks for
 */
function refuseLoop(memo, from, to) {
  // With no memo, nothing waits on a promise, and the chain's depth limit
  // stops a loop. At the page itself, nothing can wait on the page.
  if (!memo || from === null) return;

  if (!includesByMemo.has(memo)) includesByMemo.set(memo, new Map());
  const edges = includesByMemo.get(memo);

  const way = wayBetween(edges, to, from, new Set());
  if (way) {
    throw new Error(`[transclude] <transclude> includes itself: ${[...way, to].join(' includes ')}.`);
  }

  if (!edges.has(from)) edges.set(from, new Set());
  edges.get(from).add(to);
}

/**
 * The loads from `start` to `end` along the edges, or null when there is no
 * way. A depth-first walk, which is enough for a graph the size of one app's
 * includes.
 *
 * @param {Map<string, Set<string>>} edges
 * @param {string} start
 * @param {string} end
 * @param {Set<string>} seen
 * @returns {string[]|null}
 */
function wayBetween(edges, start, end, seen) {
  if (start === end) return [start];
  seen.add(start);

  for (const next of edges.get(start) ?? []) {
    if (seen.has(next)) continue;
    const rest = wayBetween(edges, next, end, seen);
    if (rest) return [start, ...rest];
  }
  return null;
}
