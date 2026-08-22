// What a config means when it does not say.
//
// Split out of `project.js` because that file reads a disk and this has to run
// where there is no disk. `loadProject` is Node's way in, and a worker has no
// equivalent: it imports `transclude.config.js` directly, so the object reaching
// `createApp` there is exactly what the author wrote and nothing more.
//
// That gap was live for a while. `fragmentParam` was only ever filled in by
// `loadProject`, so on workerd `config.fragmentParam` was undefined, the check
// for it read as "no parameter configured", and every `?fragment=` request was
// answered with the whole document. A swap then wrote a second copy of the page
// into the element it was meant to replace. It looked like a compiler bug and it
// was a missing default.
//
// Applied in `createApp` rather than in each entry, so there is one place and no
// runtime can skip it.
//
// No `node:` imports.

/** Every key with a value, and the value it takes when the config is quiet. */
export const DEFAULTS = {
  appDir: 'app',
  routesDir: 'routes',
  elementsDir: 'elements',
  publicDir: 'public',
  iconsDir: 'icons',
  outDir: 'dist',
  typesFile: 'app/transclude-env.d.ts',
  stylesheet: null,
  lang: 'en',
  fragmentParam: 'fragment',
  trailingSlash: 'never',
  strict: false,
  csrf: true,
  csp: false,
  speculate: false,
  // `<link rel="canonical">` on every page, pointing at the page's own URL. Off
  // by default because a page mounted at a second URL on purpose would get a
  // wrong one, and a wrong canonical is worse than none: it hands the ranking to
  // the other URL.
  canonical: false,
  // `(source, file) => html`, and a `.md` page under `routes/` without one is an
  // error naming the file. This package ships no Markdown parser: which flavor
  // and which extensions are the app's to pick, the same way `cache` is a store
  // the app supplies rather than a database this one depends on.
  markdown: null,
};

/**
 * Keys a config may set that have no default, listed so the check below does not
 * read them as typos.
 *
 * A key is here when leaving it out has to mean something other than a value.
 * There is no feed to write down as the default feed, and no store to write down
 * as the default `cache`: absent is how an app says it wants neither.
 */
const UNDEFAULTED = [
  'cache',
  'cookieSecret',
  'feed',
  'fragmentHeader',
  'metadataBase',
  'onError',
  'port',
  'precache',
  'proxy',
  'sitemap',
  'watchElements',
];

/** Every key `transclude.config.js` may set. */
export const KEYS = new Set([...Object.keys(DEFAULTS), ...UNDEFAULTED]);

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
export function withDefaults(config = {}) {
  // A key nothing reads is a line the author believes is doing something. The
  // failure it replaces is silent and expensive: `stylesheeet` cost a site its
  // whole stylesheet and said nothing, because an ignored key looks exactly like
  // a key that worked.
  const unknown = Object.keys(config).filter((key) => !KEYS.has(key));
  if (unknown.length) {
    throw new Error(
      `[transclude] transclude.config.js sets ${unknown.join(', ')}, which nothing reads. ` +
        `The keys are ${[...KEYS].sort().join(', ')}.`,
    );
  }

  const merged = { ...DEFAULTS, ...config };

  // Set but empty is refused at boot rather than at the first signed cookie,
  // because that first read happens in production, at request time, days after
  // the deploy that broke it. It happened: `wrangler secret put` took a blank
  // line, so the binding existed and carried nothing. `null` stays fine, since
  // that is how an app says it signs nothing.
  if (merged.cookieSecret === '') {
    throw new Error(
      `[transclude] \`cookieSecret\` is an empty string. Whatever supplies it handed ` +
        `over nothing: on a worker that is usually a \`wrangler secret put\` that took ` +
        `a blank line. Set a real secret, or \`null\` for none.`,
    );
  }

  // Refused here because there are four places that render a page and only two of
  // them could fall back to a request's origin. Left to the render, `canonical`
  // would work in dev and throw in the build, which is the dev-and-production
  // disagreement this file exists to stop.
  if (merged.canonical && !merged.metadataBase) {
    throw new Error(
      `[transclude] \`canonical: true\` needs \`metadataBase\`, which is the origin the ` +
        `URL is built from. A request's own origin is the wrong one twice: behind a proxy ` +
        `it is the internal address, and a prerendered page has no request at all.`,
    );
  }

  return merged;
}
