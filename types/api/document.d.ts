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
export declare function responseOf(): {
    status: number;
    headers: Headers;
};
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
export declare function absoluteFrom(base: string | null | undefined, requestUrl: string): (path: string) => string;
export type Ctx = {
    url: string;
    params: Record<string, string>;
    route: {
        id: string;
        pattern: string;
        path: string;
    };
    /**
     * the platform's own, not a wrapper
     */
    request: Request;
    /**
     * the region asked for, or null for a document
     */
    fragment: string | null;
    action: string | null;
    response: ReturnType<typeof responseOf>;
    cookies: ReturnType<typeof import('./cookies.js').cookiesOf>;
    absolute: (path: string) => string;
    revalidateTag: (tag: string) => void;
    after: (work: Promise<unknown>) => void;
    /**
     * what the levels above returned.
     * Added by the fold rather than by the server, so it is not one of the eleven
     * and `test/context-shape.test.js` does not look for it.
     */
    layout?: Record<string, unknown>;
};
export type PageModule = {
    load: (ctx: Ctx) => Promise<Record<string, unknown>>;
    render: (data: object, slots?: object, fragment?: boolean) => Record<string, string>;
    renderHead: (data: object) => string;
    renderTitle: (data: object) => string;
    renderHtmlAttrs: (data: object) => Record<string, unknown>;
    renderBodyAttrs: (data: object) => Record<string, unknown>;
    hasTitle: boolean;
    /**
     * emitted verbatim, ahead of the stylesheet
     */
    headScript: string;
    css: string;
    elements: import('./runtime/index.js').Definition[];
    /**
     * outermost first
     */
    layouts: PageModule[];
    client: {
        tags: string[];
        hasScript: boolean;
        needed: boolean;
    };
    includes: {
        key: string;
        kind: string;
        where: string;
        id: string;
    }[];
    regions?: Record<string, (data: object) => string>;
    /**
     * what `export const revalidate` said, read by `src/cache.js`
     */
    revalidate?: number | {
        seconds: number;
        tags?: string[];
    } | false | null;
    /**
     * the params a
     * dynamic route can be built for, which is what the build and the sitemap ask
     */
    paths?: () => Promise<Array<Record<string, string>>>;
    /**
     * the verb exports. One per method the
     */
    POST?: (ctx: Ctx) => unknown;
    /**
     * page answers, and `ACTION_METHODS` is
     */
    PUT?: (ctx: Ctx) => unknown;
    /**
     * the list of them
     */
    PATCH?: (ctx: Ctx) => unknown;
    DELETE?: (ctx: Ctx) => unknown;
};
export type RenderOptions = {
    clientEntry?: string | null;
    stylesheet?: string | null;
    lang?: string;
    speculate?: string | null;
    canonical?: string | null | boolean;
    csp?: boolean | object;
    /**
     * the resolver. `route` reads
     * another route of this app and `resolve` reads another site, and an app that
     * allows neither has neither.
     */
    include?: {
        route?: (where: string, id: string, ctx: Ctx, options: RenderOptions) => Promise<string | null>;
        resolve?: (where: string, id: string) => Promise<string | null>;
    } | null;
    /**
     * one request's worth
     */
    includeMemo?: Map<string, unknown>;
    /**
     * what is already being resolved, for a cycle
     */
    includeChain?: string[];
};
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
export declare function renderRoute(page: PageModule, ctx: Ctx, options?: RenderOptions): Promise<string | Response>;
/**
 * The markup for every `<transclude>` naming another document.
 *
 * All of them at once: ten includes off one page should be one round of work,
 * and the resolver holds the parsed document so several from one source cost one
 * read. A source that cannot be read is null here and the element falls back to
 * its own children, or throws if it has none.
 */
export declare const INCLUDE_DEPTH = 10;
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
export declare function paramsFor(route: {
    pattern: string;
}, pathname: string): Record<string, string> | null;
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
export declare function urlFor(route: {
    pattern: string;
}, params: Record<string, string>): string;
/**
 * @param {Array<{ key: string, kind: string, where: string, id: string }>} includes
 * @param {Ctx} ctx
 * @param {RenderOptions} [options] carries `include`, `includeMemo` and `includeChain`
 * @returns {Promise<Record<string, string|null>>} keyed by the src as written
 */
export declare function resolveIncludes(includes: Array<{
    key: string;
    kind: string;
    where: string;
    id: string;
}>, ctx: Ctx, options?: RenderOptions): Promise<Record<string, string | null>>;
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
export declare function renderFragment(page: PageModule, ctx: Ctx, { region, ...options }?: {
    region?: string | null;
    include?: object;
    includeMemo?: Map<string, unknown>;
}): Promise<string | Response | null>;
/**
 * The methods a server routes to `runAction`. Both servers register all of them
 * for every route: a page that answers none of them should say 405 with an
 * `Allow` header rather than fall through to the not-found page, because the URL
 * is not what was wrong.
 *
 * A `<form>` only ever sends GET or POST. The rest are here for the callers that
 * are not forms.
 */
export declare const ACTION_METHODS: string[];
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
export declare function runGuards(page: PageModule, ctx: Ctx): Promise<Response | null>;
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
export declare function runAction(page: PageModule, ctx: Ctx, method: string): Promise<{
    response?: Response;
    action?: object;
} | null>;
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
export declare function withEnvelope(response: Response, ctx: Ctx): Response;
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
export declare function regionOf(page: PageModule | null | undefined, region: string): Function | null;
/**
 * Whether a page answers for this region. An empty name means the whole page,
 * which every page answers for.
 *
 * @param {PageModule|null|undefined} page
 * @param {string} region
 * @returns {boolean}
 */
export declare function hasRegion(page: PageModule | null | undefined, region: string): boolean;
/**
 * What a page answers, for an `Allow` header. GET is not optional.
 *
 * @param {object|null|undefined} page
 * @returns {string[]} for an Allow header
 */
export declare function methodsOf(page: object | null | undefined): string[];
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
export declare function renderDocument(chain: PageModule[], datas: object[], { clientEntry, stylesheet, lang, speculate, canonical }?: {
    clientEntry?: string | null;
    stylesheet?: string | null;
    lang?: string;
    speculate?: string | null;
    canonical?: string | null;
}): string;
