/**
 * `set` appends rather than replaces: two cookies are two `Set-Cookie` headers,
 * and `Headers.set` would throw the first one away.
 *
 * `secret` comes from the config, which is the app's file, so where it comes from,
 * whether an env var or a secret manager, is the app's decision and not the
 * framework's. Without it, signing is an error rather than a silent downgrade to
 * unsigned, because a signature nobody checks is worse than none.
 *
 * @param {Request} request
 * @param {{ headers: Headers }} response the shared envelope
 * @param {string|null} [secret] without one, `signed` throws rather than writing unsigned
 * @returns {object} `get`, `set`, `delete`, `all`, `signed`, and the `personal` flag the cache reads
 */
export declare function cookiesOf(request: Request, response: {
    headers: Headers;
}, secret?: string | null): object;
