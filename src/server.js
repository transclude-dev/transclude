// The Hono app both servers start from.
//
// One function rather than two `new Hono()` calls, because the order things are
// registered in *is* the behaviour: a guard registered after the static handler
// does not guard a prerendered page. Two copies of that order is two servers
// that disagree, which has happened twice in this codebase already.

import { Hono } from 'hono';
import { csrf } from 'hono/csrf';
import { headerPolicy } from './csp.js';
import { trimTrailingSlash } from 'hono/trailing-slash';

/**
 * `strict: false` so /about and /about/ are the same page.
 *
 * CSRF is on by default and the only middleware that is. This framework's whole
 * form story is `<form method="post">`, and a cross-origin page can post one to
 * you without any of the checks a `fetch` would have to pass. Hono's guard is
 * scoped to exactly that hole: non-GET requests carrying one of the three
 * content types a form element can send. JSON already needs a preflight, so it
 * is not the way in.
 *
 * `middleware` is the app's own `server.js`, and it runs after, so it can add
 * anything and cannot register itself ahead of the guard by mistake.
 */
const OPTIONS = new Set(['csrf', 'csp', 'trailingSlash', 'publicFiles', 'middleware']);

export function baseApp(options = {}) {
  const {
    csrf: csrfOption = true,
    csp: cspOption = false,
    trailingSlash = 'never',
    publicFiles = null,
    middleware = null,
  } = options;

  // A key this does not know is a caller that thinks it configured something.
  // `publicRoot` instead of `publicFiles` was exactly that: dev served no public
  // files at all, production served them, and nothing said why.
  const unknown = Object.keys(options).filter((key) => !OPTIONS.has(key));
  if (unknown.length) {
    throw new Error(
      `[transclude] baseApp does not know ${unknown.join(', ')}. ` +
        `It takes ${[...OPTIONS].join(', ')}.`,
    );
  }

  if (trailingSlash !== 'never' && trailingSlash !== 'ignore') {
    throw new Error(
      `[transclude] trailingSlash must be 'never' or 'ignore', not ${JSON.stringify(trailingSlash)}`,
    );
  }

  /**
   * One decision with two halves, which is why it is a single config key rather
   * than a router option plus a middleware the author has to remember to add.
   *
   * `strict: false` does not merely match /about/ as well as /about: it strips
   * the slash from `c.req.path` before any middleware runs. Measured: with it on,
   * `trimTrailingSlash` never fires, because the thing it looks for is gone by
   * the time it looks. The two exclude each other.
   *
   * So 'never' means strict routing plus a 301 to the one URL, and every
   * URL this framework generates is already that form: `routes/about.html` is
   * `/about`. 'ignore' is the loose router, which answers both with 200. Two URLs
   * for one page, and nothing emits <link rel="canonical">.
   *
   * `alwaysRedirect` matters because Hono's default only redirects a request that
   * already 404'd, and a catch-all route answers before it can. `/docs/intro/`
   * would match `/docs/:path{.+}` as `intro/` and return 200, which is the exact
   * duplicate this setting exists to remove. Redirecting ahead of the router also
   * spares a doomed request the route table and every middleware after this one.
   */
  const app = new Hono({ strict: trailingSlash === 'never' });
  if (trailingSlash === 'never') app.use('*', trimTrailingSlash({ alwaysRedirect: true }));

  if (csrfOption) app.use('*', csrf(csrfOption === true ? undefined : csrfOption));

  // The half of the policy a `<meta>` cannot carry. It names no hash, so it is
  // the same string for every page and costs a prerendered one nothing. Before
  // anything that answers, so a static file gets it too.
  const header = headerPolicy(cspOption);
  if (header) {
    app.use('*', async (c, next) => {
      await next();
      c.header(header.name, header.value);
    });
  }
  if (typeof middleware === 'function') middleware(app);

  // After the app's middleware, so a guard can cover these too, and before the
  // route table, so a real file always beats a `[...path]` catch-all.
  //
  // A handler rather than a directory: what can serve a file is the one thing that
  // genuinely differs between runtimes. Node hands in Hono's `serveStatic`, which
  // does byte ranges off a disk; a runtime with no disk hands in something that
  // reads an asset binding. This file stays free of either.
  if (publicFiles) app.use('*', publicFiles);

  return app;
}

/** Where an app puts its middleware. Relative to `appDir`. */
export const SERVER_FILE = 'server.js';

/**
 * An endpoint is a `.js` file in the routes tree: a route with no template, no
 * layout and no regions, which answers with a `Response` of its own.
 *
 *   // app/routes/api/notes.js
 *   export const GET = () => Response.json(notes);
 *   export const DELETE = ({ params }) => { … };
 *
 * Handlers are named for the method, spelled the way HTTP spells it. Uppercase
 * is not decoration: `export const delete` is a syntax error and `DELETE` is not,
 * not. A page's handlers are spelled the same way.
 *
 * Returning a `Response` is required rather than encouraged. There is no
 * template to fall back to, and a handler that returns a bare object has almost
 * certainly forgotten `Response.json`.
 */
export async function runEndpoint(mod, ctx, method) {
  const name = method.toUpperCase();
  // Membership, not shape. `mod.HELPERS` may well be a function, and a request
  // naming it would otherwise reach it.
  if (!ENDPOINT_METHODS.includes(name)) return null;

  const handler = mod?.[name];
  if (typeof handler !== 'function') return null;

  const out = await handler(ctx);
  if (out instanceof Response) return out;

  throw new Error(
    `${name} answered with ${out === undefined ? 'nothing' : typeof out}, ` +
      `not a Response. An endpoint has no template to render instead`,
  );
}

/**
 * The methods an endpoint can answer. `app.all` routes every one of them to it,
 * so this is the list that decides which exports are handlers. The shim reads
 * the same list, or a name would be dispatched and not checked, or checked and
 * never dispatched.
 */
export const ENDPOINT_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

/** What an endpoint answers, for an `Allow` header. */
export function endpointMethods(mod) {
  return ENDPOINT_METHODS.filter((name) => typeof mod?.[name] === 'function').sort();
}
