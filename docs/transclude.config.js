// Where the app lives. Every path the framework needs is here.

export default {
  appDir: 'app',

  // Dev and production both listen here, so this app has one port.
  port: 1962,

  routesDir: 'routes',
  // One directory for every element. A shadow root is opt-in per file.
  elementsDir: 'elements',

  stylesheet: 'app/styles/global.css',

  strict: false,

  // Every page on this site is a document with no per-request state, so the
  // build writes each one to a file and no page carries a region loader.
  fragmentParam: null,

  csrf: true,

  // A Content-Security-Policy in the document, built from the hashes of what it
  // inlines. Every page here is a file, so the policy is written once and needs
  // no server.
  csp: true,

  // GET /sitemap.xml, from the route table. Every page here is a concrete route,
  // so nothing has to be listed by hand.
  sitemap: { hostname: 'https://transclude.dev' },

  // The origin `ctx.absolute()` resolves against. The request's own is wrong
  // behind a proxy, and there is no request at all while prerendering.
  metadataBase: 'https://transclude.dev',

  // Fonts and favicon. Copied, not compiled.
  publicDir: 'public',

  trailingSlash: 'never',

  fragmentHeader: null,

  // No forms and no sessions here, so nothing signs a cookie.
  cookieSecret: null,

  outDir: 'dist',
  typesFile: 'app/transclude-env.d.ts',
};
