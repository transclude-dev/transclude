// Where the app lives. This is the whole interface to the framework: every path
// the package needs is here, and nothing in the package names one of its own.
// `transclude` is a dependency now, so this file is all that connects them.

import { people } from "./app/data/people.js";

export default {
  appDir: "app",

  // Documents this app may read. Default deny: without a host named here there
  // is no proxy route and no external include can resolve.
  proxy: {
    allow: ["developer.mozilla.org"],
  },

  // A feed of the people pages. The items are the app's to supply: a route
  // table holds URLs and a feed needs something to read.
  feed: {
    hostname: "https://showcase.example",
    title: "Showcase people",
    description: "Everyone with a page here.",
    items: () =>
      people.map((person) => ({
        title: person.name,
        path: `/people/${person.slug}`,
        date: person.joined,
        description: person.note,
      })),
  },

  // Dev and production both listen here, so this app has one port.
  port: 1961,

  // Relative to appDir. Named rather than assumed so the convention is stated
  // somewhere a reader can find it.
  //
  // `routes`, not `pages`, because it holds both: a `.html` file there is a page,
  // a `.js` file is an endpoint, and the thing they have in common is being a
  // route. The extension decides which.
  routesDir: "routes",
  // One directory for every element. A shadow root is opt-in per file:
  // `export const shadow = true`, in either script block.
  elementsDir: "elements",

  // The global stylesheet, relative to the project root. Served through Vite,
  // so nesting, @import and PostCSS all work. Set to null for none.
  stylesheet: "app/styles/global.css",

  // Type annotations are optional: JSDoc is a comment, and `npm run check`
  // still catches a misspelled field, an unknown prop and a wrong-typed one
  // without any. Set true for full TypeScript strictness, which additionally
  // requires every parameter to have a declared type.
  strict: false,

  // The query parameter that asks a page for one of its `[fragment]` regions
  // instead of the whole document: `/search?fragment=results`.
  //
  // A parameter rather than a header, so the fragment has a URL of its own. It can
  // be linked, logged, opened in a tab and cached on its own, and it works the same
  // whatever is doing the asking.
  //
  // Swapping a region into a live page is a client's job, and this framework
  // does not ship one. Bring htmx, Turbo, or your own fetch. What it does ship
  // is the piece none of them can do for themselves: with fragments on, every
  // page carries the loader that defines and styles a tag it never rendered, so
  // markup swapped in from any route works whoever put it there.
  //
  // Set to null and no page carries anything. A page then ships exactly what it
  // renders, which is the content-site case.
  fragmentParam: "fragment",

  // Markup swapped into a page here can name an element that page never
  // rendered, so every page carries the script that notices a new tag and loads
  // its definition and styles. Off by default: it is only worth the script when
  // swaps really do bring in elements.
  watchElements: true,

  // Cross-site request forgery. On by default, and the only middleware the
  // framework registers for you: the whole form story here is
  // `<form method="post">`, and a page on another origin can post one to you
  // without passing any of the checks a `fetch` would have to. Hono's guard is
  // scoped to exactly that hole: non-GET requests carrying one of the three
  // content types a form element can send.
  //
  // `false` turns it off. An object is passed to `hono/csrf` as options, which is
  // how you allow another origin: `{ origin: 'https://admin.example' }`.
  csrf: true,

  // Files served as-is at the root of the site: robots.txt, favicon.ico, images,
  // downloads. Relative to appDir like the directories above, because it is part
  // of the site rather than of the project scaffolding. `null` for none.
  //
  // Not built and not compiled, only copied. Served by Hono's own static middleware
  // rather than the in-memory cache the build output uses, because these are
  // yours: they can be large, and they can be media, which needs byte ranges.
  publicDir: "public",

  // `never` redirects /about/ to /about with a 301. Every URL this framework
  // generates is already slash-free, so `routes/about.html` is `/about`. This
  // keeps one form rather than inventing one. `ignore` answers both
  // with 200, which is two URLs for one page and no <link rel="canonical">.
  //
  // There is no `always` on purpose. The file-to-URL mapping cannot produce a
  // trailing slash, so adding one would disagree with every href it writes.
  trailingSlash: "never",

  // A request header that may name a region, for clients that already send one.
  // htmx sends `HX-Target` with the id of the element it is about to swap, which is
  // the same thing as a region name, so `hx-get="/notes" hx-target="#notes"` works
  // with no query parameter and no framework client code.
  //
  // Off by default, and not out of squeamishness: switching it on means these
  // routes must answer `Vary: HX-Target`, and a cache key is a bad thing to widen
  // for a feature an app may not use. Set it to the header your client sends.
  //
  // Unlike `?fragment=`, this is best-effort: a header naming something that is
  // not a region is ignored rather than a 404, because htmx sends it on every
  // request including `hx-boost` ones that want the whole document.
  fragmentHeader: null,

  // Signs cookies, which is what makes one usable as a session: the client can
  // read the value but cannot forge it. Read it from the environment here. This
  // file is yours, so where the secret lives is your decision. Without one,
  // `ctx.cookies.signed` throws rather than quietly writing an unsigned cookie.
  // `globalThis.process?.env`, not `process.env`: this module is imported by the
  // worker build too, and a runtime without Node compatibility has no `process`.
  // A bare reference is a ReferenceError before anything runs.
  cookieSecret: globalThis.process?.env?.COOKIE_SECRET ?? null,

  // Relative to the project root.
  outDir: "dist",
  typesFile: "app/transclude-env.d.ts",
};
