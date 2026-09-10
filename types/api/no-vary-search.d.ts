/**
 * Whether a cache reading `value` would treat `param` as making no difference.
 *
 * `key-order` alone is fine: it reorders and ignores nothing. An empty
 * `params=()` is fine for the same reason. An empty `except=()` is the opposite,
 * because an allowlist of nothing allows nothing to matter.
 *
 * A value naming `params` or `except` in a shape this cannot read counts as
 * hiding. Being wrong that way costs an author one error naming their header;
 * being wrong the other way costs a reader a broken swap and says nothing.
 *
 * @param {string|null|undefined} value the `No-Vary-Search` header
 * @param {string} param the parameter to ask about
 * @returns {boolean}
 */
export declare function hidesParam(value: string | null | undefined, param: string): boolean;
/**
 * Throws when the header would hide the fragment parameter.
 *
 * Called on the way out rather than checked at boot, because the header can come
 * from a loader's `ctx.response` or from the app's own middleware, and neither
 * runs during a build.
 *
 * @param {string|null|undefined} value the `No-Vary-Search` header
 * @param {string|null|undefined} param the configured `fragmentParam`
 * @throws when a cache reading the header would ignore `param`
 */
export declare function refuseHiddenFragment(value: string | null | undefined, param: string | null | undefined): void;
