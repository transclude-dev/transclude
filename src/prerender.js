// What a page is allowed to be, if it is going to be a file.
//
// A prerendered page is written once and served to everyone. It has no status,
// no headers and no reader. So a loader that answers with a `Response`, sets a
// status, writes a header or reads a cookie is saying this URL is not a page you
// can write down, and the build says so rather than writing a file that lies
// about it.
//
// Split out of `bin/build.js` so the refusals can be tested. Nothing imports
// that file: it is a script that runs a build the moment it is loaded, so every
// message here used to be checked by hand or not at all.
//
// No `node:` imports, though nothing needs that of this file yet. It is here
// because the three modules it calls have the same rule.

import { absoluteFrom, responseOf } from './document.js';
import { cookiesOf } from './cookies.js';

/**
 * The `ctx` a loader is handed while the build renders it to a file.
 *
 * `revalidateTag` and `after` are refusals rather than absences. Left off the
 * object they are `undefined`, and a loader calling one fails with `x is not a
 * function`, which names neither what the page did nor how to stop. Both stay in
 * the generated type either way, because the checker cannot know which pages
 * become files.
 *
 * @param {object} options
 * @param {{ id: string, pattern?: string }} options.route
 * @param {string} options.url the path being written
 * @param {Record<string, string>} options.params
 * @param {string|null} [options.cookieSecret]
 * @param {string} [options.metadataBase]
 * @returns {object} the same shape a request gets, minus what a file cannot have
 */
export function prerenderContext({ route, url, params, cookieSecret = null, metadataBase }) {
  const response = responseOf();

  return {
    url: `http://localhost${url}`,
    params,
    route: { id: route.id, pattern: route.pattern ?? '', path: url },
    // Null here and at no other time, which is how a shared layout can skip the
    // part that needs a visitor.
    request: null,
    fragment: null,
    action: null,
    response,
    cookies: cookiesOf(null, response, cookieSecret),
    absolute: absoluteFrom(metadataBase, null),

    revalidateTag: () => {
      throw new Error(
        `called \`ctx.revalidateTag\`, and a build holds no rendered pages to drop. ` +
          `Give it \`export const prerender = false\`, or move the call to the action ` +
          `or endpoint that changes the data`,
      );
    },

    after: () => {
      throw new Error(
        `called \`ctx.after\`, and a file has no response for that work to outlive. ` +
          `Give it \`export const prerender = false\`, or start the work from an ` +
          `endpoint or an action instead`,
      );
    },
  };
}

/**
 * Throws unless what was rendered can be written to a file.
 *
 * Called after the render rather than during it, because three of the four are
 * things a loader does on the way past and only the finished `ctx` knows about.
 * Every message continues a sentence whose subject is the page, since that is
 * what the build prints above it.
 *
 * @param {object} ctx the context the render was given
 * @param {string|Response} html what the render answered
 * @throws when this URL cannot be one file
 */
export function refusePrerender(ctx, html) {
  if (html instanceof Response) {
    throw new Error(`answered with ${html.status} instead of markup, so it cannot be prerendered`);
  }

  if (ctx.response.status !== 200) {
    throw new Error(`answered ${ctx.response.status}, which no file can carry`);
  }

  // A file carries no headers either. A Set-Cookie or a Cache-Control written
  // here would be thrown away, which is worse than being told.
  const [header] = [...ctx.response.headers.keys()];
  if (header) {
    throw new Error(`set a ${header} header, which no file can carry`);
  }

  // Reading a cookie is what makes a page personal, and there is no request here
  // to read one from. Whatever this file says about the reader is what a reader
  // with no cookies would have seen, and every visitor gets that copy. A layout
  // or an included route can do this without the page mentioning it, which is
  // what makes it worth saying out loud.
  if (ctx.cookies.personal) {
    throw new Error(
      `read a cookie, so it is different for each visitor and cannot be one file. ` +
        `Give it \`export const prerender = false\`, or stop reading the cookie ` +
        `here or in what it includes`,
    );
  }
}
