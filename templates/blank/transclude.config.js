// Every path the framework needs is here, relative to `appDir` unless it says
// otherwise. `npx transclude-check` reads this too.
//
// The keys left out have defaults, and the defaults are the quiet ones: no
// proxy, no feed, no sitemap, no service worker list, no script on any page.
// See the configuration page in the docs for the whole list.

export default {
  appDir: 'app',
  routesDir: 'routes',
  elementsDir: 'elements',
  stylesheet: 'app/styles/global.css',

  // Dev and production both listen here, so this app has one port. `PORT` in the
  // environment wins.
  port: 1960,

  // `never` redirects /about/ to /about with a 301, so a page has one URL.
  trailingSlash: 'never',

  // Signs cookies, which is what makes one usable as a session. Read it from the
  // environment: this file is yours, so where the secret lives is your decision.
  cookieSecret: globalThis.process?.env?.COOKIE_SECRET ?? null,

  outDir: 'dist',
  typesFile: 'app/transclude-env.d.ts',
};
