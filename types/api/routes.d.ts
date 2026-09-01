/**
 * @param {string} dir
 * @returns {{ routes: Route[], endpoints: Route[], notFound: Route|null,
 *   error: object|null }} the pages, the endpoints, and the two pages that are
 *   reached for rather than routed to
 */
export declare function scanRoutes(dir: string): {
    routes: Route[];
    endpoints: Route[];
    notFound: Route | null;
    error: object | null;
};
export type Segment = {
    kind: 'static' | 'param' | 'rest';
    name: string;
};
export type Route = {
    kind: 'page' | 'endpoint';
    /**
     * the path without its extension
     */
    id: string;
    /**
     * the absolute path on disk
     */
    file: string;
    /**
     * the same, relative to the routes directory
     */
    rel: string;
    segments: Segment[];
    /**
     * what Hono matches on
     */
    pattern: string;
    /**
     * the dynamic segments, in order
     */
    params: string[];
    /**
     * whether a `[...rest]` segment is in there
     */
    hasRest: boolean;
};
export type ManifestRoute = {
    /**
     * the route id, which is the path without its extension
     */
    id: string;
    /**
     * what Hono matches on
     */
    pattern: string;
    /**
     * the dynamic segments, in order
     */
    params: string[];
    /**
     * the file, relative to the routes directory
     */
    rel?: string;
    /**
     * what this route ships to a browser, or null for the many that ship nothing
     */
    client?: {
        tags: string[];
        hasScript: boolean;
        needed: boolean;
    } | null;
};
export type Manifest = {
    /**
     * every page, whether it was prerendered or not
     */
    routes: ManifestRoute[];
    endpoints: ManifestRoute[];
    /**
     * the routes left to the server, build only
     */
    dynamic?: ManifestRoute[];
    /**
     * what `export const gated` said, so `/sitemap.xml`
     * at runtime leaves out what the build left out
     */
    gated?: string[];
    notFound?: {
        id: string;
    } | null;
    error?: {
        id: string;
    } | null;
    stylesheet?: string | null;
    /**
     * the rules, already rendered
     */
    speculate?: string | null;
    version?: string;
};
/**
 * A segment of a route's path, after the brackets are read.
 *
 * @typedef {{ kind: 'static'|'param'|'rest', name: string }} Segment
 */
/**
 * One route, as the scanner knows it. `ManifestRoute` below is the half that
 * survives into `dist/routes.json`: a runtime has no filesystem to resolve
 * `file` against and nothing left to parse.
 *
 * @typedef {object} Route
 * @property {'page'|'endpoint'} kind
 * @property {string} id the path without its extension
 * @property {string} file the absolute path on disk
 * @property {string} rel the same, relative to the routes directory
 * @property {Segment[]} segments
 * @property {string} pattern what Hono matches on
 * @property {string[]} params the dynamic segments, in order
 * @property {boolean} hasRest whether a `[...rest]` segment is in there
 */
/**
 * One route, as `dist/routes.json` carries it.
 *
 * @typedef {object} ManifestRoute
 * @property {string} id the route id, which is the path without its extension
 * @property {string} pattern what Hono matches on
 * @property {string[]} params the dynamic segments, in order
 * @property {string} [rel] the file, relative to the routes directory
 * @property {{ tags: string[], hasScript: boolean, needed: boolean }|null} [client]
 *   what this route ships to a browser, or null for the many that ship nothing
 */
/**
 * `dist/routes.json`: the route table the build serialized, and the few things a
 * runtime cannot work out for itself.
 *
 * `plugin.api.manifest()` builds it at compile time and `bin/build.js` writes it
 * with three more fields. `createApp` reads both, on four runtimes, which is why
 * the shape is written here once rather than in each entry that passes it on.
 *
 * @typedef {object} Manifest
 * @property {ManifestRoute[]} routes every page, whether it was prerendered or not
 * @property {ManifestRoute[]} endpoints
 * @property {ManifestRoute[]} [dynamic] the routes left to the server, build only
 * @property {string[]} [gated] what `export const gated` said, so `/sitemap.xml`
 *   at runtime leaves out what the build left out
 * @property {{ id: string }|null} [notFound]
 * @property {{ id: string }|null} [error]
 * @property {string|null} [stylesheet]
 * @property {string|null} [speculate] the rules, already rendered
 * @property {string} [version]
 */
/**
 * @param {string} rel the path under the routes directory
 * @param {string} file
 * @returns {Route} its id, URL pattern, params and kind
 */
export declare function toRoute(rel: string, file: string): Route;
/**
 * The routes directory, or a migration error.
 *
 * It was `pages/` until it started holding `.js` endpoints as well as `.html`
 * pages, at which point the name was no longer true. A missing directory otherwise
 * produces an empty route table and a site of 404s, which is a confusing way to
 * learn about a rename.
 *
 * @param {string} app the app directory
 * @param {string} routesDir from the config
 * @returns {string}
 * @throws when the old `pages/` name is still there
 */
export declare function resolveRoutesDir(app: string, routesDir: string): string;
