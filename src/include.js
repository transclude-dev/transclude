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
  const foreign = config.proxy
    ? includeResolver(config.proxy, { lookup: config.proxy.lookup ?? lookup ?? null })
    : null;

  const context = {
    resolve: foreign?.resolve ?? null,

    route: async (path, id, ctx, options) => {
      const loaded = await loadOnce(path, ctx, options);
      if (!loaded) return null;

      const target = regionOf(loaded.page, id);
      if (!target) return null;
      return renderLoaded(loaded.page, loaded.data, target);
    },
  };

  /**
   * A route's loaders, run once per request however many of its fragments the
   * page includes, so every one of them renders from the same data. Keyed by
   * the path, query included, and held as the promise: includes that start
   * together still share one run.
   */
  function loadOnce(path, ctx, options) {
    const memo = options?.includeMemo;
    if (memo?.has(path)) return memo.get(path);

    const loading = load(path, ctx, options);
    memo?.set(path, loading);
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
  async function load(path, ctx, options) {
    const url = new URL(path, ctx.url);

    let found = null;
    for (const route of routes) {
      const params = paramsFor(route, url.pathname);
      if (params) {
        found = { route, params };
        break;
      }
    }
    if (!found) throw new Error(`[transclude] no route answers ${path}`);

    const page = await pageFor(found.route.id);
    if (!page) throw new Error(`[transclude] ${path} is not a page`);

    const data = await loadFragment(
      page,
      {
        ...ctx,
        url: url.href,
        params: found.params,
        route: { id: found.route.id, pattern: found.route.pattern, path: url.pathname },
        // The include is not the request. A loader that branches on the region
        // asked for should see this render for what it is.
        fragment: null,
        action: null,
      },
      { ...options, include: context },
    );

    // A loader answering for itself has nothing to say here: the including page
    // asked for markup, not for a redirect.
    if (data instanceof Response) return null;
    return { page, data };
  }

  return context;
}
