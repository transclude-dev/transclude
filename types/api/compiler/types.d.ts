/**
 * @param {{ components?: object[], partials?: object[], layouts?: object[],
 *   pages?: object[], types?: {name: string, type: string}[] }} [what] each
 *   element carries its `tag`, its props `type`, its `members`, its `state` and
 *   whether anything `upgrades` it. `partials` is the light elements: the key is
 *   the old name and is load-bearing until the callers change with it. `types`
 *   are the names the app declared that the strings below use.
 * @returns {string} the contents of transclude-env.d.ts
 */
export declare function emitTypes({ components, partials, layouts, pages, types, }?: {
    components?: object[];
    partials?: object[];
    layouts?: object[];
    pages?: object[];
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
