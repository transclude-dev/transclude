// Where the app lives. Every path the framework needs is here.

import { byDate } from './app/data/posts.js';

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

  // Every page here is a file, so the browser may run one early rather than
  // only fetch it. The block is inline script, and `csp: true` hashes it with
  // everything else the page inlines.
  speculate: true,

  // GET /sitemap.xml, from the route table. Every page here is a concrete route,
  // so nothing has to be listed by hand.
  sitemap: { hostname: 'https://transclude.dev' },

  // A list of what the build produced, at /precache.json. The framework ships
  // no service worker: only the build knows an asset's hashed name, so this is
  // the half an app cannot write for itself.
  precache: true,

  // GET /feed.xml. The route table cannot answer this one: a feed is a list of
  // writing in the order it was written, and only the posts know that.
  feed: {
    hostname: 'https://transclude.dev',
    title: 'transclude',
    description: 'Posts about the web platform, and about building on it.',
    author: { name: 'Joe Dakroub' },
    items: () =>
      byDate().map((post) => ({
        title: post.title,
        path: `/blog/${post.slug}`,
        date: post.date,
        description: post.summary,
      })),
  },

  // The origin `ctx.absolute()` resolves against. The request's own is wrong
  // behind a proxy, and there is no request at all while prerendering.
  metadataBase: 'https://transclude.dev',

  // `<link rel="canonical">` on every page. The docs layout used to write this
  // one line for the pages under it, which left the landing page and the blog
  // without one.
  canonical: true,

  // Fonts and favicon. Copied, not compiled.
  publicDir: 'public',

  trailingSlash: 'never',

  fragmentHeader: null,

  // No forms and no sessions here, so nothing signs a cookie.
  cookieSecret: null,

  outDir: 'dist',
  typesFile: 'app/transclude-env.d.ts',
};
