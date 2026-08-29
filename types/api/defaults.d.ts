export type Config = {
    appDir?: string;
    routesDir?: string;
    elementsDir?: string;
    publicDir?: string;
    iconsDir?: string;
    outDir?: string;
    typesFile?: string;
    stylesheet?: string | null;
    lang?: string;
    fragmentParam?: string;
    trailingSlash?: 'never' | 'always' | 'ignore';
    strict?: boolean;
    csrf?: boolean;
    csp?: boolean | object;
    speculate?: boolean | object;
    canonical?: boolean;
    markdown?: ((source: string, file: string) => string) | null;
    cache?: object;
    cookieSecret?: string;
    feed?: object;
    fragmentHeader?: string;
    metadataBase?: string;
    onError?: (error: Error, at: {
        request: Request;
        url: string;
        method: string;
        route: {
            id: string;
            pattern: string;
            params: Record<string, string>;
        } | null;
        phase: string | null;
    }) => unknown;
    port?: number | string;
    precache?: object;
    proxy?: {
        cache?: object;
        lookup?: unknown;
    };
    sitemap?: object;
    watchElements?: boolean;
};
/**
 * An app's `transclude.config.js`, after `createApp` has filled in the defaults.
 *
 * Written out because `{object}` says opaque, and the code that reads a config
 * key is the code TypeScript then has nothing to say about: fifty-four errors in
 * `app.js` alone were reads of keys listed right here. This table is also a
 * promise — `VERSIONING.md` says a documented key does not change without a
 * major — so the type and the promise should be the same list.
 *
 * Everything is optional. A worker imports `transclude.config.js` directly and
 * gets exactly what the author wrote, which is why `createApp` applies
 * `DEFAULTS` rather than trusting any caller to have done it.
 *
 * The keys with no default are the app's own objects, and their shapes belong to
 * the app. Where this file names one it names only what the framework itself
 * reaches for.
 *
 * @typedef {{
 *   appDir?: string,
 *   routesDir?: string,
 *   elementsDir?: string,
 *   publicDir?: string,
 *   iconsDir?: string,
 *   outDir?: string,
 *   typesFile?: string,
 *   stylesheet?: string|null,
 *   lang?: string,
 *   fragmentParam?: string,
 *   trailingSlash?: 'never'|'always'|'ignore',
 *   strict?: boolean,
 *   csrf?: boolean,
 *   csp?: boolean|object,
 *   speculate?: boolean|object,
 *   canonical?: boolean,
 *   markdown?: ((source: string, file: string) => string)|null,
 *   cache?: object,
 *   cookieSecret?: string,
 *   feed?: object,
 *   fragmentHeader?: string,
 *   metadataBase?: string,
 *   onError?: (error: Error, at: {
 *     request: Request, url: string, method: string,
 *     route: { id: string, pattern: string, params: Record<string, string> }|null,
 *     phase: string|null,
 *   }) => unknown,
 *   port?: number|string,
 *   precache?: object,
 *   proxy?: { cache?: object, lookup?: unknown },
 *   sitemap?: object,
 *   watchElements?: boolean,
 * }} Config
 */
/** Every key with a value, and the value it takes when the config is quiet. */
export declare const DEFAULTS: {
    appDir: string;
    routesDir: string;
    elementsDir: string;
    publicDir: string;
    iconsDir: string;
    outDir: string;
    typesFile: string;
    stylesheet: any;
    lang: string;
    fragmentParam: string;
    trailingSlash: string;
    strict: boolean;
    csrf: boolean;
    csp: boolean;
    speculate: boolean;
    canonical: boolean;
    markdown: any;
};
/** Every key `transclude.config.js` may set. */
export declare const KEYS: Set<string>;
/**
 * A config with every default filled in.
 *
 * A key the author wrote wins, including one written as `null` or `false`. Only
 * an absent key takes the default, which is what lets `fragmentParam: null` turn
 * the parameter off rather than quietly turning it back on.
 *
 * @param {Config} [config] whatever `transclude.config.js` exported
 * @returns {Config} the same keys, plus the ones it did not mention
 * @throws when `canonical` is on and there is no origin to build a URL from
 */
export declare function withDefaults(config?: Config): Config;
