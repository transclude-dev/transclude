// The Hono app both servers start from.
//
// One function rather than two `new Hono()` calls, because the order things are
// registered in *is* the behaviour: a guard registered after the static handler
// does not guard a prerendered page. Two copies of that order is two servers
// that disagree, which has happened twice in this codebase already.

import { Hono } from 'hono';
import { csrf } from 'hono/csrf';

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
 * `middleware` is the app's own `server.js`, run after — so it can add anything
 * and cannot accidentally register itself ahead of the guard.
 */
export function baseApp({ csrf: csrfOption = true, middleware = null } = {}) {
  const app = new Hono({ strict: false });

  if (csrfOption) app.use('*', csrf(csrfOption === true ? undefined : csrfOption));
  if (typeof middleware === 'function') middleware(app);

  return app;
}

/** Where an app puts its middleware. Relative to `appDir`. */
export const SERVER_FILE = 'server.js';

/**
 * An endpoint is a `.js` file in the pages tree: a route with no template, no
 * layout and no regions, which answers with a `Response` of its own.
 *
 *   // app/pages/api/notes.js
 *   export const GET = () => Response.json(notes);
 *   export const DELETE = ({ params }) => { … };
 *
 * Handlers are named for the method, spelled the way HTTP spells it. Uppercase
 * is not decoration: `export const delete` is a syntax error and `DELETE` is not,
 * which is why a page's `actions` had to be an object and this does not.
 *
 * Returning a `Response` is required rather than encouraged. There is no
 * template to fall back to, and a handler that returns a bare object has almost
 * certainly forgotten `Response.json`.
 */
export async function runEndpoint(mod, ctx, method) {
  const handler = mod?.[method.toUpperCase()];
  if (typeof handler !== 'function') return null;

  const out = await handler(ctx);
  if (out instanceof Response) return out;

  throw new Error(
    `${method.toUpperCase()} answered with ${out === undefined ? 'nothing' : typeof out}, ` +
      `not a Response — an endpoint has no template to render instead`,
  );
}

/** What an endpoint answers, for an `Allow` header. */
export function endpointMethods(mod) {
  return Object.keys(mod ?? {})
    .filter((name) => /^[A-Z]+$/.test(name) && typeof mod[name] === 'function')
    .sort();
}
