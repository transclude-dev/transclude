import { withPolicy } from './csp.js';

// Assembles the document around a layout chain.
//
// The chain is outermost layout first, page last. Body markup folds inward-out:
// the page renders, then each layout renders around what it got.

/**
 * Loads a page's chain and renders the document. Layout loaders run outermost
 * first, each one given what the ones above returned, so they have to run one
 * after another.
 */
/**
 * The part of the answer that is not markup: a status and some headers.
 *
 * One object, handed to every loader in the chain and mutated in place. Loaders
 * are called with `{ ...ctx, layout }`, so a scalar assigned onto `ctx` would be
 * lost on the copy. This survives because the copy carries the same reference.
 * Built here rather than in each server, because there are three of them and
 * that is exactly how two servers end up disagreeing.
 */
export function responseOf() {
  return { status: 200, headers: new Headers() };
}

/**
 * `ctx.absolute('/og.png')` -> `https://site.com/og.png`.
 *
 * A canonical URL, an `og:image` and a feed all have to be absolute, and the
 * request's own origin is the wrong answer twice: behind a proxy it is the
 * internal one, and while prerendering there is no request at all. So the origin
 * comes from `metadataBase` when it is set, and falls back to the request.
 *
 * A path that is already absolute is returned untouched, so a value that came
 * from somewhere else can be passed through without checking it first.
 *
 * @param {string|null|undefined} base `metadataBase` from the config
 * @param {string} requestUrl
 * @returns {(path: string) => string} `ctx.absolute`
 */
export function absoluteFrom(base, requestUrl) {
  return (path) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return path;

    const origin = base ?? requestUrl;
    if (!origin) {
      throw new Error(
        `[transclude] absolute(${JSON.stringify(path)}) has no origin to resolve against. ` +
          `Set \`metadataBase\` in the config, which is what a prerendered page uses.`,
      );
    }
    return new URL(path, origin).href;
  };
}

/**
 * What a loader is handed.
 *
 * The eleven fields below are the promise `VERSIONING.md` makes, and
 * `test/context-shape.test.js` is what keeps this list, `src/app.js` and
 * `bin/dev.js` saying the same thing. Several are spelled as the return of the
 * function that builds them, so there is one description of each and not two.
 *
 * @typedef {object} Ctx
 * @property {string} url
 * @property {Record<string, string>} params
 * @property {{ id: string, pattern: string, path: string }} route
 * @property {Request} request the platform's own, not a wrapper
 * @property {string|null} fragment the region asked for, or null for a document
 * @property {string|null} action
 * @property {ReturnType<typeof responseOf>} response
 * @property {ReturnType<typeof import('./cookies.js').cookiesOf>} cookies
 * @property {(path: string) => string} absolute
 * @property {(tag: string) => void} revalidateTag
 * @property {(work: Promise<unknown>) => void} after
 * @property {Record<string, unknown>} [layout] what the levels above returned.
 *   Added by the fold rather than by the server, so it is not one of the eleven
 *   and `test/context-shape.test.js` does not look for it.
 */

/**
 * One compiled page or layout module.
 *
 * `src/compiler/index.js` emits every name here, and `PAGE_EXPORTS` there is
 * the same list read from the other side: a block declaring one of these is
 * refused, because both would land in the same scope.
 *
 * @typedef {object} PageModule
 * @property {(ctx: Ctx) => Promise<Record<string, unknown>>} load
 * @property {(data: object, slots?: object, fragment?: boolean) => Record<string, string>} render
 * @property {(data: object) => string} renderHead
 * @property {(data: object) => string} renderTitle
 * @property {(data: object) => Record<string, unknown>} renderHtmlAttrs
 * @property {(data: object) => Record<string, unknown>} renderBodyAttrs
 * @property {boolean} hasTitle
 * @property {string} headScript emitted verbatim, ahead of the stylesheet
 * @property {string} css
 * @property {import('./runtime/index.js').Definition[]} elements
 * @property {PageModule[]} layouts outermost first
 * @property {{ tags: string[], hasScript: boolean, needed: boolean }} client
 * @property {{ key: string, kind: string, where: string, id: string }[]} includes
 * @property {Record<string, (data: object) => string>} [regions]
 * @property {number|{ seconds: number, tags?: string[] }|false|null} [revalidate]
 *   what `export const revalidate` said, read by `src/cache.js`
 * @property {() => Promise<Array<Record<string, string>>>} [paths] the params a
 *   dynamic route can be built for, which is what the build and the sitemap ask
 * @property {(ctx: Ctx) => unknown} [POST] the verb exports. One per method the
 * @property {(ctx: Ctx) => unknown} [PUT] page answers, and `ACTION_METHODS` is
 * @property {(ctx: Ctx) => unknown} [PATCH] the list of them
 * @property {(ctx: Ctx) => unknown} [DELETE]
 */

/**
 * What a render is told about the app around it.
 *
 * @typedef {object} RenderOptions
 * @property {string|null} [clientEntry]
 * @property {string|null} [stylesheet]
 * @property {string} [lang]
 * @property {string|null} [speculate]
 * @property {string|null|boolean} [canonical]
 * @property {boolean|object} [csp]
 * @property {{ route?: (where: string, id: string, ctx: Ctx, options: RenderOptions)
 *   => Promise<string|null>, resolve?: (where: string, id: string)
 *   => Promise<string|null> } | null} [include] the resolver. `route` reads
 *   another route of this app and `resolve` reads another site, and an app that
 *   allows neither has neither.
 * @property {Map<string, unknown>} [includeMemo] one request's worth
 * @property {string[]} [includeChain] what is already being resolved, for a cycle
 */

/**
 * Which `<meta>` and `<link>` may appear once, and what identifies them.
 *
 * `name`, `property` and `http-equiv` each name a different meta. Only
 * `rel="canonical"` is unique among links: a page has several `alternate`s for
 * its feeds and translations, and several `preload`s, all meant.
 */
function headKey(tag) {
  const name = tagAttr(tag, 'name');
  if (name !== null) return `meta name=${name.toLowerCase()}`;

  const property = tagAttr(tag, 'property');
  if (property !== null) return `meta property=${property.toLowerCase()}`;

  const equiv = tagAttr(tag, 'http-equiv');
  if (equiv !== null) return `meta http-equiv=${equiv.toLowerCase()}`;

  const rel = tagAttr(tag, 'rel');
  if (rel !== null && rel.toLowerCase() === 'canonical') return 'link rel=canonical';

  return null;
}

const ATTR = /([a-zA-Z][\w-]*)\s*=\s*"([^"]*)"/g;

/** A quoted value cannot hold a `"`, because both escapers turn it into `&quot;`. */
function tagAttr(tag, want) {
  ATTR.lastIndex = 0;
  for (let m = ATTR.exec(tag); m; m = ATTR.exec(tag)) {
    if (m[1].toLowerCase() === want) return m[2];
  }
  return null;
}

/**
 * Where a `<meta>` or `<link>` ends.
 *
 * Quote-aware, because `escapeAttr` leaves `>` alone: `content="a > b"` is legal
 * HTML and stops nothing, and looking for the first `>` would cut the tag in
 * half.
 */
function tagEnd(html, from) {
  let quote = null;
  for (let i = from; i < html.length; i++) {
    const c = html[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      return i + 1;
    }
  }
  return html.length;
}

const HEAD_TAG = /<(meta|link)\b/gi;

/** Every uniquely-named tag in one level's head, as `{ start, end, key }`. */
function keyedTags(html) {
  const found = [];
  HEAD_TAG.lastIndex = 0;
  for (let m = HEAD_TAG.exec(html); m; m = HEAD_TAG.exec(html)) {
    const end = tagEnd(html, m.index);
    const key = headKey(html.slice(m.index, end));
    if (key) found.push({ start: m.index, end, key });
    HEAD_TAG.lastIndex = end;
  }
  return found;
}

/**
 * A tag an inner level restates, dropped from the outer one.
 *
 * The chain was concatenated, so a root layout with a default `og:image` and a
 * page with its own shipped both. That is not an override: a crawler reads two
 * `og:image` as two images and takes the first, which is the outermost, which is
 * backwards. This is the rule `htmlAttrsOf` applies to `<html>`, which `<head>`
 * never got.
 *
 * Across levels only. Two `og:image` at one level are deliberate and both stay.
 *
 * @param {string[]} parts one rendered head per level, outermost first
 * @returns {string[]} the same, with what an inner level owns removed
 */
function mergeHead(parts) {
  if (parts.length < 2) return parts;

  const tags = parts.map((html) => (html ? keyedTags(html) : []));
  const claimed = new Set();
  const out = new Array(parts.length);

  // Innermost first, so the first level to claim a key is the one that keeps it.
  for (let i = parts.length - 1; i >= 0; i--) {
    const drop = tags[i].filter((tag) => claimed.has(tag.key));

    if (drop.length) {
      let html = '';
      let at = 0;
      for (const tag of drop) {
        html += parts[i].slice(at, tag.start);
        at = tag.end;
      }
      out[i] = (html + parts[i].slice(at)).trim();
    } else {
      out[i] = parts[i];
    }

    // After the level is done, so two of one key written here both survive.
    for (const tag of tags[i]) claimed.add(tag.key);
  }
  return out;
}

/** A name that cannot break out of the tag it is written into. */
const ATTR_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

// The same four the runtime's `attr` escapes. A quoted value only strictly needs
// `&` and `"`, but two escapers that disagree is a difference somebody has to
// hold in their head.
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

const escapeAttr = (value) => String(value).replace(/[&<>"]/g, (c) => ESCAPES[c]);

/**
 * The head the framework writes, as the outermost level of the merge.
 *
 * Through `mergeHead` rather than beside it, so a page or a layout writing its
 * own `viewport` or `canonical` replaces this one instead of shipping a second
 * copy. `charset` is not here: it has to be inside the first 1024 bytes, and it
 * is not something to override.
 *
 * @param {string|null} canonical the page's own URL, absolute, or null for none
 * @returns {string} one level's worth of head markup
 */
function frameworkHead(canonical) {
  const tags = ['<meta name="viewport" content="width=device-width, initial-scale=1">'];
  if (canonical) tags.push(`<link rel="canonical" href="${escapeAttr(canonical)}">`);
  return tags.join('\n');
}

/**
 * `<html …>`, with `lang` first and whatever a loader added after it.
 *
 * Values are escaped, because the reason this exists is putting a preference on
 * the element, and a preference usually comes from a cookie. `true` writes the
 * name bare and `false` drops it, the same rule the template compiler uses.
 */
/**
 * Every `<html>` in the chain, merged by name.
 *
 * Outermost first so the innermost wins, per attribute rather than outright: a
 * root layout setting the theme and a page setting `dir` both survive. Written
 * as one tag, because two `data-theme` attributes would leave the parser taking
 * the first, which is the outermost, which is backwards.
 */
function attrsOf(chain, datas, render) {
  const merged = { __proto__: null };
  for (let i = 0; i < chain.length; i++) {
    Object.assign(merged, chain[i][render]?.(datas[i]));
  }
  return merged;
}

/**
 * `<html …>` or `<body …>`, from a merged attribute object.
 *
 * @param {string} tag
 * @param {object} attrs
 * @returns {string} the open tag
 */
function openTag(tag, attrs) {
  const parts = [];

  for (const [name, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) continue;
    if (!ATTR_NAME.test(name)) {
      throw new Error(
        `[transclude] \`${name}\` cannot be an attribute on <${tag}>. ` +
          `Use lowercase letters, digits and dashes.`,
      );
    }
    parts.push(value === true ? name : `${name}="${escapeAttr(value)}"`);
  }

  return parts.length ? `<${tag} ${parts.join(' ')}>` : `<${tag}>`;
}

/**
 * Loads a page's chain and renders the document, or returns the `Response` a
 * loader answered with instead.
 *
 * Returning one is how a loader redirects, or serves something that is not this
 * page at all. It is the same convention an action already uses, so there is one
 * rule rather than two. A layout can do it too, which is what makes an auth redirect
 * a layout's job: nothing below it runs.
 *
 * For everything else the page still renders, and `ctx.response` decides what it
 * is wrapped in: a 404 status on a page that renders its own "not found" body, an
 * `HX-Trigger` header, a `Set-Cookie`.
 *
 * @param {PageModule} page a compiled page module
 * @param {Ctx} ctx the request context
 * @param {RenderOptions} [options] `clientEntry`, `stylesheet`, `csp`, `lang`,
 *   `include`, `canonical`
 * @returns {Promise<string|Response>} a Response when a loader answered for itself
 */
export async function renderRoute(page, ctx, options = {}) {
  // Held for this request only. A page including one route twice should run its
  // loaders once; a store that outlived the request would be a second page cache
  // nobody audited.
  const request = { ...options, includeMemo: options.includeMemo ?? new Map() };
  const chain = [...page.layouts, page];
  const datas = [];
  let inherited = {};

  for (const mod of chain) {
    const data = await mod.load({ ...ctx, layout: inherited });
    if (data instanceof Response) return data;

    // Before the render, because render is synchronous the whole way down and
    // reading another document is not. A layout and a page each resolve their
    // own, so neither can see the other's by accident.
    datas.push(
      mod.includes?.length
        ? { ...data, __included: await resolveIncludes(mod.includes, ctx, request) }
        : data,
    );
    if (mod !== page) inherited = { ...inherited, ...data };
  }

  // The config's `canonical` is a yes or no; the document's is the URL. Turned
  // into one here because this is the layer that holds the request, and because
  // the four callers that render a page would otherwise each compute it.
  //
  // `route.path` and not the request's URL: a canonical URL names the page, so a
  // query parameter has no place in it. That the path is already free of a
  // trailing slash is Hono's doing under `trailingSlash: 'ignore'`, which is the
  // setting that makes this option worth having.
  const html = renderDocument(chain, datas, {
    ...options,
    canonical: options.canonical ? ctx.absolute(ctx.route.path) : null,
  });

  // After the document exists, because the policy is built from what it inlined.
  // A prerendered page runs this once at build time and carries the result.
  return withPolicy(html, options.csp);
}

/**
 * The markup for every `<transclude>` naming another document.
 *
 * All of them at once: ten includes off one page should be one round of work,
 * and the resolver holds the parsed document so several from one source cost one
 * read. A source that cannot be read is null here and the element falls back to
 * its own children, or throws if it has none.
 */
export const INCLUDE_DEPTH = 10;

/**
 * The parameters a route's pattern takes from a path, or null if it does not
 * match.
 *
 * Only what a route pattern can hold: `:name` and a trailing `:name{.+}`. An
 * include names a path an author wrote, so this answers the same question the
 * router does without needing the router.
 *
 * @param {{ pattern: string }} route
 * @param {string} pathname
 * @returns {Record<string, string>|null} null when the route does not match
 */
export function paramsFor(route, pathname) {
  const names = [];

  const catchAll = (_, name) => {
    names.push(name);
    return '/(.+)';
  };
  const segment = (_, name) => {
    names.push(name);
    return '([^/]+)';
  };

  const source = route.pattern
    .replace(/\/:([A-Za-z0-9_]+)\{\.\+\}/g, catchAll)
    .replace(/:([A-Za-z0-9_]+)/g, segment);

  const found = new RegExp(`^${source}$`).exec(pathname);
  if (!found) return null;

  return Object.fromEntries(names.map((name, at) => [name, decodeURIComponent(found[at + 1])]));
}

/**
 * The URL a route and a set of params name. The other direction from
 * `paramsFor`, and the two have to agree.
 *
 * The build writes a file at this URL and the sitemap advertises it. Each had
 * its own copy of the substitution, so a pattern shape one handled and the other
 * did not would have meant a sitemap listing URLs that were never written.
 *
 * @param {{ pattern: string }} route
 * @param {Record<string, string>} params
 * @returns {string} the pattern with every `:name` filled in
 */
export function urlFor(route, params) {
  return route.pattern.replace(/:(\w+)(\{[^}]*\})?/g, (_, name) => String(params[name] ?? ''));
}

/**
 * @param {Array<{ key: string, kind: string, where: string, id: string }>} includes
 * @param {Ctx} ctx
 * @param {RenderOptions} [options] carries `include`, `includeMemo` and `includeChain`
 * @returns {Promise<Record<string, string|null>>} keyed by the src as written
 */
export async function resolveIncludes(includes, ctx, options = {}) {
  const include = options.include ?? null;
  const chain = options.includeChain ?? [];

  const pairs = await Promise.all(
    includes.map(async ({ key, kind, where, id }) => {
      // A page that includes itself, directly or through three others, would
      // otherwise render until the stack ran out. The chain is carried so the
      // error can name the way round.
      if (chain.includes(key)) {
        throw new Error(
          `[transclude] <transclude> includes itself: ` +
            `${[...chain, key].join(' includes ')}.`,
        );
      }
      if (chain.length >= INCLUDE_DEPTH) {
        throw new Error(
          `[transclude] <transclude src="${key}"> is ${chain.length} includes deep, ` +
            `past the limit of ${INCLUDE_DEPTH}.`,
        );
      }

      const next = { ...options, includeChain: [...chain, key] };

      try {
        if (kind === 'route') {
          if (!include?.route) {
            throw new Error(
              `[transclude] <transclude src="${key}"> reads another route, ` +
                `and this renderer was given no way to reach one.`,
            );
          }
          return [key, await include.route(where, id, ctx, next)];
        }

        if (!include?.resolve) {
          throw new Error(
            `[transclude] <transclude src="${key}"> reads another site, ` +
              `and no host is allowed to be read. Name one in \`proxy.allow\`.`,
          );
        }
        return [key, await include.resolve(where, id)];
      } catch (error) {
        // A source that is unreachable is what the fallback is for. A source
        // that is misconfigured, or a loop, is a mistake and should be heard.
        if (/includes itself|past the limit|no host is allowed|no way to reach/.test(error.message)) {
          throw error;
        }
        return [key, null];
      }
    }),
  );
  return Object.fromEntries(pairs);
}

/**
 * One region of a page, for swapping into a document that already exists.
 *
 * The layout loaders still run: a page's own loader is handed what they
 * returned, so skipping them would change the data the region renders from.
 * What is skipped is the layouts' markup. A fragment is a piece of the page, not a
 * document.
 *
 * Returns null when the page has no region by that name, which is a 404 rather
 * than an empty swap: asking for something that does not exist should say so.
 *
 * @param {PageModule} page
 * @param {Ctx} ctx
 * @param {{ region?: string|null, include?: object, includeMemo?: Map<string, unknown> }}
 *   [options] everything but `region` travels on to the includes
 * @returns {Promise<string|Response|null>} null when no such region
 */
export async function renderFragment(page, ctx, { region = null, ...options } = {}) {
  const target = region ? regionOf(page, region) : null;
  if (region && !target) return null;

  const chain = [...page.layouts, page];
  let inherited = {};
  let data = {};

  for (const mod of chain) {
    data = await mod.load({ ...ctx, layout: inherited });
    // A loader answering with a Response outranks the region that was asked for.
    if (data instanceof Response) return data;
    if (mod !== page) inherited = { ...inherited, ...data };
  }

  const last = chain[chain.length - 1];
  if (last.includes?.length) {
    // The same memo `renderRoute` makes, for the same reason: one route
    // included twice renders once, and the store dies with the request.
    const request = { ...options, includeMemo: options.includeMemo ?? new Map() };
    data = { ...data, __included: await resolveIncludes(last.includes, ctx, request) };
  }

  // `true` is `__named`: the fragment keeps the id it was declared with, because
  // that is what a swap is matched against. An include of the same region passes
  // false, since two copies of one id in a document is the bug that rule exists
  // to stop.
  const named = true;

  // No region named: the page's whole body, still without its layouts.
  if (!target) return page.render(data, {}, named).default ?? '';
  return target(data, {}, named);
}

/**
 * The methods a server routes to `runAction`. Both servers register all of them
 * for every route: a page that answers none of them should say 405 with an
 * `Allow` header rather than fall through to the not-found page, because the URL
 * is not what was wrong.
 *
 * A `<form>` only ever sends GET or POST. The rest are here for the callers that
 * are not forms.
 */
export const ACTION_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * The layouts' answer to a request that is about to change something, or null
 * when every one of them let it through.
 *
 * A layout loader returning a `Response` is how a login redirect is written once
 * for everything below it, and until this existed that only held for the render.
 * The action ran first, so a signed-out POST reached the handler, mutated, and
 * then met the guard on the way back out. The reader got the redirect, which is
 * what a request stopped at the door also gets, so nothing anywhere said the
 * handler had run.
 *
 * The data is thrown away. `renderRoute` loads the chain again afterwards, which
 * is a second run of every layout loader on an action request, and the price of
 * the render seeing what the action just did rather than what was true before it.
 *
 * @param {PageModule} page a compiled page module
 * @param {Ctx} ctx the request context
 * @returns {Promise<Response|null>} the first layout that answered for itself
 */
export async function runGuards(page, ctx) {
  let inherited = {};

  for (const layout of page.layouts) {
    const data = await layout.load({ ...ctx, layout: inherited });
    if (data instanceof Response) return data;
    inherited = { ...inherited, ...data };
  }

  return null;
}

/**
 * Runs the page's handler for a request that is not a GET.
 *
 * A `Response` is the author's own answer and goes out as it is: a redirect after
 * a POST, JSON, a 404. Anything else becomes `ctx.action`, and the page
 * then renders exactly the way it does for a GET: `load` stays the one thing
 * that decides what a page renders, whatever method asked for it. So a form
 * that re-renders with an error reads the same as a form that redirects, and
 * neither has to restate the page's data.
 *
 * `null` is "this page does not answer that method", which is a 405 rather than
 * a 404. The URL exists.
 *
 * @param {PageModule} page
 * @param {Ctx} ctx
 * @param {string} method
 * @returns {Promise<{ response?: Response, action?: object }|null>} what the
 *   handler returned, for the render after it
 */
export async function runAction(page, ctx, method) {
  // `method` is whatever arrived on the wire, and reading a verb export by name
  // off a shape with no index signature is not something the type allows. The
  // shape deliberately has none: every other read of a page module is a name.
  const action = /** @type {Record<string, unknown>} */ (page)[method];
  if (typeof action !== 'function') return null;

  const result = await action(ctx);
  return result instanceof Response ? { response: result } : { action: result ?? {} };
}

/**
 * A short-circuiting `Response`, carrying whatever the envelope collected.
 *
 * Set a session cookie and then redirect, which is an ordinary thing for an action
 * to do, and the cookie would otherwise be dropped. The action's `Response` is
 * returned directly, and nothing looks at `ctx.response` on that path.
 * `Response.redirect()` makes it worse than a silent loss, because its headers
 * are immutable and appending to them throws.
 *
 * So the headers go onto a copy. `new Response(body, response)` keeps the status
 * and every header the author set, and comes with a mutable guard.
 *
 * @param {Response} response
 * @param {Ctx} ctx
 * @returns {Response} a copy, because a redirect's headers cannot be written to
 */
export function withEnvelope(response, ctx) {
  const collected = [...(ctx?.response?.headers ?? [])];
  if (!collected.length) return response;

  const merged = new Response(response.body, response);
  for (const [name, value] of collected) merged.headers.append(name, value);
  return merged;
}

/**
 * Whether a page can answer for a region name. An empty name is the page's own
 * body, which always exists.
 *
 * Asked *before* an action runs. A misspelled region is a 404 either way, but a
 * request that cannot be answered should not have mutated anything on its way to
 * saying so.
 */
/**
 * The render function for a named region, or null.
 *
 * Own properties only, and it has to be a function. The name comes from a query
 * string, so a plain lookup answers for everything on `Object.prototype`:
 * `?fragment=constructor` found `Object`, which is truthy and callable, so the
 * region was "found", the action before it ran, and the reply was whatever
 * `Object(data)` stringifies to. `hasRegion` is the check that an action runs
 * behind, so a name that gets past it gets past that too.
 *
 * @param {PageModule|null|undefined} page a compiled page module
 * @param {string} region             the name from the URL
 * @returns {Function|null}
 */
export function regionOf(page, region) {
  const regions = page?.regions;
  if (!regions || !Object.hasOwn(regions, region)) return null;
  return typeof regions[region] === 'function' ? regions[region] : null;
}

/**
 * Whether a page answers for this region. An empty name means the whole page,
 * which every page answers for.
 *
 * @param {PageModule|null|undefined} page
 * @param {string} region
 * @returns {boolean}
 */
export function hasRegion(page, region) {
  return !region || regionOf(page, region) !== null;
}

/**
 * What a page answers, for an `Allow` header. GET is not optional.
 *
 * @param {object|null|undefined} page
 * @returns {string[]} for an Allow header
 */
export function methodsOf(page) {
  return ['GET', ...ACTION_METHODS.filter((method) => typeof page?.[method] === 'function')];
}

/**
 * The whole document, from the innermost page outward.
 *
 * `chain` is the layouts and then the page; `datas` is what each one's loader
 * returned, in the same order. Both are walked from the end, because a level
 * renders into the slot map of the one above it.
 *
 * @param {PageModule[]} chain the compiled modules, outermost first
 * @param {object[]} datas one per level, in the same order
 * @param {{ clientEntry?: string|null, stylesheet?: string|null, lang?: string,
 *   speculate?: string|null, canonical?: string|null }} [options] `canonical` is
 *   the URL itself, already absolute. `renderRoute` is what turns the config's
 *   yes-or-no into one, because this function sees no request.
 * @returns {string} the document, starting at `<!doctype html>`
 */
export function renderDocument(
  chain,
  datas,
  { clientEntry, stylesheet, lang = 'en', speculate = null, canonical = null } = {},
) {
  // Each level renders to a slot map and hands it to the level above, so a page
  // can fill more than one hole in its layout.
  let slots = {};
  for (let i = chain.length - 1; i >= 0; i--) {
    slots = chain[i].render(datas[i], slots);
  }
  const body = slots.default ?? '';

  // The innermost <title> wins outright. Kept as its own render function rather
  // than sliced out of rendered head markup, so this is a compile-time fact.
  let title = '';
  for (let i = chain.length - 1; i >= 0; i--) {
    if (!chain[i].hasTitle) continue;
    title = chain[i].renderTitle(datas[i]);
    break;
  }

  // Everything else accumulates outermost first, so a page's <meta> comes last
  // and a page's <style> can override a layout's. The framework's own head is the
  // outermost level; `frameworkHead` says what is in it and why.
  const [defaults, ...rest] = mergeHead([
    frameworkHead(canonical),
    ...chain.map((mod, i) => mod.renderHead(datas[i])),
  ]);
  const head = rest.filter(Boolean);

  // Ahead of the stylesheet, because a <link> blocks the scripts after it and
  // the point of a head script is to run before anything else.
  const headScripts = chain.map((mod) => mod.headScript).filter(Boolean);
  // A light element's styles are @scope-d and belong in <head> exactly once,
  // however many times it was rendered. A shadow one carries its own.
  //
  // One <style> per tag rather than one block for all of them, each named. The
  // name is what lets the client answer "are these already here?" for an element
  // that arrives later in a fragment. The document says what it has, so nothing
  // has to be tracked beside it.
  const seen = new Set();
  const scoped = [];
  const collect = (defs) => {
    for (const def of defs ?? []) {
      if (seen.has(def.tag)) continue;
      seen.add(def.tag);
      if (def.light && def.css) {
        scoped.push(`<style data-transclude="${def.tag}">\n${def.css}\n</style>`);
      }
      collect(def.elements);
    }
  };
  for (const mod of chain) collect(mod.elements);

  // Marked, and last: a page's own rules override an element's, and a style
  // adopted later has to know where to insert itself to keep that true.
  const own = chain.map((mod) => mod.css).filter(Boolean);
  const css = [
    ...scoped,
    ...(own.length ? [`<style data-transclude-page>\n${own.join('\n')}\n</style>`] : []),
  ];

  return `<!doctype html>
${openTag('html', { lang, ...attrsOf(chain, datas, 'renderHtmlAttrs') })}
<head>
<meta charset="utf-8">
${defaults}
${title}
${speculate ? `<script type="speculationrules">${speculate}</script>` : ''}
${headScripts.join('\n')}
${stylesheet ? `<link rel="stylesheet" href="${stylesheet}">` : ''}
${head.join('\n')}
${css.join('\n')}
</head>
${openTag('body', attrsOf(chain, datas, 'renderBodyAttrs'))}
${body}
${clientEntry ? `<script type="module" src="${clientEntry}"></script>` : ''}
</body>
</html>
`;
}
