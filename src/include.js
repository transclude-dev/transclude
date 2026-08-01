// What a `<transclude-fragment>` is resolved against, built once.
//
// Three servers render pages: the production app, the dev server and the build.
// Each used to be handed a piece of this and the dev server was handed less than
// the others, so an include that worked in production threw in dev with nothing
// to suggest why. One function answers it for all three.

import { paramsFor, renderFragment } from './document.js';
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
      const memo = options?.includeMemo;
      const key = `${path}#${id}`;
      if (memo?.has(key)) return memo.get(key);

      const answer = render(path, id, ctx, options);
      // The promise is held, not the result: two includes of one route that
      // start together should still be one render.
      memo?.set(key, answer);
      return answer;
    },
  };

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
  async function render(path, id, ctx, options) {
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

    const html = await renderFragment(
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
      { region: id, ...options, include: context },
    );

    // A loader answering for itself has nothing to say here: the including page
    // asked for markup, not for a redirect.
    return html instanceof Response ? null : html;
  }

  return context;
}
