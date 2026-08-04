// Where the app lives. Every path the framework needs is here.

export default {
  appDir: 'app',

  // Dev and production both listen here, so this app has one port.
  port: 1980,

  routesDir: 'routes',
  // One directory for every element. A shadow root is opt-in per file.
  elementsDir: 'elements',

  stylesheet: 'app/styles/global.css',

  strict: false,

  // The landing page says a fragment is a URL and links to one, so this site has
  // to answer it. Every page here is still written to a file at build time: a
  // prerendered document and a fragment of it are the same compiled markup, and
  // the server answers the second on the same route. It costs no client
  // JavaScript. `watchElements` is what would, and nothing here swaps anything.
  fragmentParam: 'fragment',

  csrf: true,

  // A Content-Security-Policy in the document, built from the hashes of what it
  // inlines. Every page here is a file, so the policy is written once and needs
  // no server.
  csp: true,

  // GET /sitemap.xml, from the route table. Every page here is a concrete route,
  // so nothing has to be listed by hand.
  sitemap: { hostname: 'https://transclude.dev' },

  // A list of what the build produced, at /precache.json. The framework ships
  // no service worker: only the build knows an asset's hashed name, so this is
  // the half an app cannot write for itself.
  precache: true,

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
