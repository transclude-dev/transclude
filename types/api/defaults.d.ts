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
 * @param {object} [config] whatever `transclude.config.js` exported
 * @returns {object} the same keys, plus the ones it did not mention
 * @throws when `canonical` is on and there is no origin to build a URL from
 */
export declare function withDefaults(config?: object): object;
