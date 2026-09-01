export type ElementTypes = {
    tag: string;
    /**
     * the props
     */
    type: string;
    state?: string;
    /**
     * what `export const prototype` declared
     */
    members?: string;
    /**
     * whether anything registers the element
     */
    upgrades?: boolean;
};
export type RouteTypes = {
    id: string;
    /**
     * what the loader returns
     */
    type: string;
    /**
     * the `ctx` it is handed
     */
    context?: string;
    params?: string[];
    pattern?: string;
};
/**
 * One element, as `src/typecheck.js` extracted it. Every field is a type
 * *string* that tsc's own printer produced.
 *
 * @typedef {object} ElementTypes
 * @property {string} tag
 * @property {string} type the props
 * @property {string} [state]
 * @property {string} [members] what `export const prototype` declared
 * @property {boolean} [upgrades] whether anything registers the element
 *
 * @typedef {object} RouteTypes
 * @property {string} id
 * @property {string} type what the loader returns
 * @property {string} [context] the `ctx` it is handed
 * @property {string[]} [params]
 * @property {string} [pattern]
 *
 * @param {{ components?: ElementTypes[], partials?: ElementTypes[],
 *   layouts?: RouteTypes[], pages?: RouteTypes[],
 *   types?: { name: string, type: string }[] }} [what] `partials` is the light
 *   elements: the key is the old name and is load-bearing until the callers
 *   change with it. `types` are the names the app declared that the strings
 *   below use.
 * @returns {string} the contents of transclude-env.d.ts
 */
export declare function emitTypes({ components, partials, layouts, pages, types, }?: {
    components?: ElementTypes[];
    partials?: ElementTypes[];
    layouts?: RouteTypes[];
    pages?: RouteTypes[];
    types?: {
        name: string;
        type: string;
    }[];
}): string;
/**
 * `user-card` -> `UserCard`, `people-_name` -> `PeopleName`, `404` -> `_404`.
 *
 * The result has to be a valid TypeScript identifier, and a route named for a
 * status code starts with a digit, which is a syntax error, not a style one.
 *
 * @param {string} name a tag or a route id
 * @returns {string} PascalCase, safe as a type name
 */
export declare function interfaceName(name: string): string;
