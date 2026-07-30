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
 */
export async function renderRoute(page, ctx, options = {}) {
  const chain = [...page.layouts, page];
  const datas = [];
  let inherited = {};

  for (const mod of chain) {
    const data = await mod.load({ ...ctx, layout: inherited });
    if (data instanceof Response) return data;
    datas.push(data);
    if (mod !== page) inherited = { ...inherited, ...data };
  }

  return renderDocument(chain, datas, options);
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
 */
export async function renderFragment(page, ctx, { region = null } = {}) {
  const target = region ? page.regions?.[region] : null;
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
 */
export async function runAction(page, ctx, method) {
  const action = page.actions?.[method.toLowerCase()];
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
export function hasRegion(page, region) {
  return !region || Boolean(page?.regions?.[region]);
}

/** What a page answers, for an `Allow` header. GET is not optional. */
export function methodsOf(page) {
  const declared = Object.keys(page?.actions ?? {}).map((method) => method.toUpperCase());
  return ['GET', ...declared.filter((method) => method !== 'GET')];
}

export function renderDocument(chain, datas, { clientEntry, stylesheet, lang = 'en' } = {}) {
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
  const head = chain.map((mod, i) => mod.renderHead(datas[i])).filter(Boolean);

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
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
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
