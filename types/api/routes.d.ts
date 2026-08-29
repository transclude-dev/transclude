/**
 * @param {string} dir
 * @returns {{ routes: object[], endpoints: object[], notFound: object|null,
 *   error: object|null }} the pages, the endpoints, and the two pages that are
 *   reached for rather than routed to
 */
export declare function scanRoutes(dir: string): {
    routes: object[];
    endpoints: object[];
    notFound: object | null;
    error: object | null;
};
/**
 * @param {string} rel the path under the routes directory
 * @param {string} file
 * @returns {object} its id, URL pattern, params and kind
 */
export declare function toRoute(rel: string, file: string): object;
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
