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

  // The language every page is written in, on `<html>`. A screen reader picks a
  // voice from it and a browser picks a dictionary, so a wrong one is worse than
  // a missing one. Change it here, or per page with `<html lang="cy">`.
  lang: 'en',

  // A Content-Security-Policy built from the hashes of what each page inlines.
  // Nothing here needs a CDN, so the policy is `self` and a script somebody
  // injects has nowhere to come from.
  csp: true,

  // The features these pages refuse: cameras, sensors, location, and the rest of
  // what a document never asks for. Take one out when a page wants it.
  permissionsPolicy: true,

  // Signs cookies, which is what makes one usable as a session. Read it from the
  // environment: this file is yours, so where the secret lives is your decision.
  cookieSecret: globalThis.process?.env?.COOKIE_SECRET ?? null,

  outDir: 'dist',
  typesFile: 'app/transclude-env.d.ts',
};
