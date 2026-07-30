// Where the app lives. Every path the framework needs is here.

export default {
  appDir: 'app',

  routesDir: 'routes',
  // One directory for every element. A shadow root is opt-in per file.
  elementsDir: 'elements',

  stylesheet: 'app/styles/global.css',

  strict: false,

  // Every page on this site is a document with no per-request state, so the
  // build writes each one to a file and no page carries a region loader.
  fragmentParam: null,

  csrf: true,

  // Fonts and favicon. Copied, not compiled.
  publicDir: 'public',

  trailingSlash: 'never',

  fragmentHeader: null,

  // No forms and no sessions here, so nothing signs a cookie.
  cookieSecret: null,

  outDir: 'dist',
  typesFile: 'app/transclude-env.d.ts',
};
