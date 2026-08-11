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
  // `(source, file) => html`, and a `.md` page under `routes/` without one is an
  // error naming the file. This package ships no Markdown parser: which flavour
  // and which extensions are the app's to pick, the same way `cache` is a store
  // the app supplies rather than a database this one depends on.
  markdown: null,
};

/**
 * A config with every default filled in.
 *
 * A key the author wrote wins, including one written as `null` or `false`. Only
 * an absent key takes the default, which is what lets `fragmentParam: null` turn
 * the parameter off rather than quietly turning it back on.
 *
 * @param {object} [config] whatever `transclude.config.js` exported
 * @returns {object} the same keys, plus the ones it did not mention
 */
export function withDefaults(config = {}) {
  return { ...DEFAULTS, ...config };
}
