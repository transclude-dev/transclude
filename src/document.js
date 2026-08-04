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
 * @returns {URL}
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
function htmlAttrsOf(chain, datas) {
  const merged = { __proto__: null };
  for (let i = 0; i < chain.length; i++) {
    Object.assign(merged, chain[i].renderHtmlAttrs?.(datas[i]));
  }
  return merged;
}

function htmlOpenTag(lang, attrs) {
  const parts = [];

  for (const [name, value] of Object.entries({ lang, ...attrs })) {
    if (value === false || value === null || value === undefined) continue;
    if (!ATTR_NAME.test(name)) {
      throw new Error(
        `[transclude] \`${name}\` cannot be an attribute on <html>. ` +
          `Use lowercase letters, digits and dashes.`,
      );
    }
    parts.push(value === true ? name : `${name}="${escapeAttr(value)}"`);
  }

  return `<html ${parts.join(' ')}>`;
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
 * @param {object} page a compiled page module
 * @param {object} ctx the request context
 * @param {object} [options] `clientEntry`, `stylesheet`, `csp`, `lang`, `include`
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

  const html = renderDocument(chain, datas, options);

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
  const source = route.pattern
    .replace(/\/:([A-Za-z0-9_]+)\{\.\+\}/g, (_, name) => (names.push(name), '/(.+)'))
    .replace(/:([A-Za-z0-9_]+)/g, (_, name) => (names.push(name), '([^/]+)'));

  const found = new RegExp(`^${source}$`).exec(pathname);
  if (!found) return null;

  return Object.fromEntries(names.map((name, at) => [name, decodeURIComponent(found[at + 1])]));
}

/**
 * @param {Array<{ key: string, kind: string, where: string, id: string }>} includes
 * @param {object} ctx
 * @param {object} [options] carries `include`, `includeMemo` and `includeChain`
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
 * @param {object} page
 * @param {object} ctx
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

  // No region named: the page's whole body, still without its layouts.
  if (!target) return page.render(data, {}, true).default ?? '';
  return target(data, {}, true);
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
 * @param {object} page
 * @param {object} ctx
 * @param {string} method
 * @returns {Promise<object>} what the handler returned, for the render after it
 */
export async function runAction(page, ctx, method) {
  const action = page[method];
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
 * @param {object} ctx
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
 * @param {object|null|undefined} page a compiled page module
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
 * @param {object|null|undefined} page
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
 * @param {object[]} chain the compiled modules, outermost first
 * @param {object[]} datas one per level, in the same order
 * @param {{ clientEntry?: string|null, stylesheet?: string|null, lang?: string }} [options]
 * @returns {string} the document, starting at `<!doctype html>`
 */
export function renderDocument(
  chain,
  datas,
  { clientEntry, stylesheet, lang = 'en' } = {},
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
  // and a page's <style> can override a layout's.
  // The framework's own defaults go through the merge as the outermost level, so
  // a page or a layout writing its own `viewport` replaces this one instead of
  // shipping beside it. `charset` is not here: it has to be inside the first
  // 1024 bytes and is not something to override.
  const [defaults, ...rest] = mergeHead([
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
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
${htmlOpenTag(lang, htmlAttrsOf(chain, datas))}
<head>
<meta charset="utf-8">
${defaults}
${title}
${headScripts.join('\n')}
${stylesheet ? `<link rel="stylesheet" href="${stylesheet}">` : ''}
${head.join('\n')}
${css.join('\n')}
</head>
<body>
${body}
${clientEntry ? `<script type="module" src="${clientEntry}"></script>` : ''}
</body>
</html>
`;
}
