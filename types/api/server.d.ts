/**
 * @param {{ csrf?: object|boolean, csp?: object|boolean, trailingSlash?: string,
 *   publicFiles?: import('hono').MiddlewareHandler|null,
 *   middleware?: ((app: import('hono').Hono) => void)|null }} [options]
 *   `middleware` is the app's own `server.js`, which is handed the Hono app
 *   rather than mounted on it
 * @returns {import('hono').Hono} a Hono app
 * @throws on a key it does not know
 */
export declare function baseApp(options?: {
    csrf?: object | boolean;
    csp?: object | boolean;
    trailingSlash?: string;
    publicFiles?: import('hono').MiddlewareHandler | null;
    middleware?: ((app: import('hono').Hono) => void) | null;
}): import('hono').Hono;
/** Where an app puts its middleware. Relative to `appDir`. */
export declare const SERVER_FILE = "server.js";
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
 *
 * @param {object} mod the endpoint module
 * @param {object} ctx
 * @param {string} method
 * @returns {Promise<Response|null>} null when the module answers no such verb
 */
export declare function runEndpoint(mod: object, ctx: object, method: string): Promise<Response | null>;
/**
 * The methods an endpoint can answer. `app.all` routes every one of them to it,
 * so this is the list that decides which exports are handlers. The shim reads
 * the same list, or a name would be dispatched and not checked, or checked and
 * never dispatched.
 */
export declare const ENDPOINT_METHODS: string[];
/**
 * What an endpoint answers, for an `Allow` header.
 *
 * @param {object|null|undefined} mod
 * @returns {string[]} sorted, for an Allow header
 */
export declare function endpointMethods(mod: object | null | undefined): string[];
