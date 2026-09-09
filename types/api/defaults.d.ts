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
    fragmentParam?: string | null;
    trailingSlash?: 'never' | 'ignore';
    strict?: boolean;
    csrf?: boolean | object;
    csp?: boolean | {
        directives?: Record<string, string[]>;
        reportOnly?: boolean;
    };
    speculate?: boolean | object;
    canonical?: boolean;
    markdown?: ((source: string, file: string) => string) | null;
    cache?: import('./cache.js').CacheStore;
    cookieSecret?: string;
    feed?: import('./feed.js').FeedConfig;
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
    proxy?: import('./proxy.js').ProxyConfig;
    sitemap?: import('./sitemap.js').SitemapConfig;
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
 * A key's type is what the runtime accepts, which is not always what reads well
 * next to it. `trailingSlash` had `'always'` in the union and nothing ever
 * implemented it: `baseApp` threw, `test/server.test.js` asserted the throw, the
 * docs named two values, and this table shipped the third to every app's editor.
 * `csrf` and `fragmentParam` drifted the other way and promised less than the
 * docs did. `test/defaults.test.js` reads this union now, so the three cannot
 * disagree again quietly.
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
 *   fragmentParam?: string|null,
 *   trailingSlash?: 'never'|'ignore',
 *   strict?: boolean,
 *   csrf?: boolean|object,
 *   csp?: boolean|{ directives?: Record<string, string[]>, reportOnly?: boolean },
 *   speculate?: boolean|object,
 *   canonical?: boolean,
 *   markdown?: ((source: string, file: string) => string)|null,
 *   cache?: import('./cache.js').CacheStore,
 *   cookieSecret?: string,
 *   feed?: import('./feed.js').FeedConfig,
 *   fragmentHeader?: string,
 *   metadataBase?: string,
 *   onError?: (error: Error, at: {
 *     request: Request, url: string, method: string,
 *     route: { id: string, pattern: string, params: Record<string, string> }|null,
 *     phase: string|null,
 *   }) => unknown,
 *   port?: number|string,
 *   precache?: object,
 *   proxy?: import('./proxy.js').ProxyConfig,
 *   sitemap?: import('./sitemap.js').SitemapConfig,
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
