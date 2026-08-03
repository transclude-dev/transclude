# transclude

HTML is the product. A page is an `.html` file, the server renders it, and what
arrives is markup a browser already knows how to display. Nothing has to run for
the page to be correct.

The directory tree is the route table. A page answers GET, its verb exports answer
POST and the other verbs, and a `.js` file in the same tree is an endpoint that
returns a `Response`. The server is Hono.

An element marked `fragment` can be asked for on its own URL. That is the hypermedia
part: a region is a resource, and the same compiled markup serves it inline and
alone. This framework ships nothing that swaps one in. htmx, Turbo or a short
`fetch` does that.

An `.html` file in `elements/` becomes a custom element. Light DOM by default:
no boundary, page CSS reaches it, `<label for>` works, no JavaScript shipped.
`export const shadow = true` gives it a shadow root and a re-render on an
attribute change. The shadow half is the harder half of the compiler and answers
a narrower question than most pages ask, so stay light unless you want the
boundary.

The same app runs on Node, Bun, Deno and workerd. The browser downloads no runtime
dependencies.

This repository is the package. `examples/showcase` is an app built against it,
installed from `file:../..` like any other project would install it. `npm test`
runs 515 tests here and needs no app. `npm run test:examples` runs the demo's, and
`npm run showcase` starts it, which is where the browser checks are.

## House style

Comments: one to three sentences. Add one only when it says something the code
cannot. Leave it out otherwise.

Words: short and plain. No jargon. No em dashes. Write so that someone reading
English as a second language gets it on the first pass. This applies to comments,
commit messages, the README, and anything else written here. `hypermedia`,
`element` and `fragment` are the exceptions: they name things this framework is
about, so use them and say what they mean the first time.

Tone: declarative. State what is true and stop. Do not sell the design, and do not
call a decision clever or important.

Branches: one per feature. Commit as often as helps. Do not merge. The user decides
when to merge.

## Layout

- `src/compiler/`. `index.js` splits blocks and assembles the module. `codegen.js`
  emits render. `bind.js` emits bind and update. `shim.js` emits the JS that tsc
  checks. `script.js` does every acorn rewrite.
- `src/runtime/index.js`. Shared by the server render and the browser element.
- `src/server.js`. The Hono app both servers start from, plus endpoints.
- `src/production.js`. The built app. `bin/serve.js` (Node), `bin/serve.bun.js`
  and `bin/serve.deno.js` are adapters that only listen.
- `src/project.js`. Finds the project root and loads its config. The one place
  that answers where the app is.
- `test/`. 515 tests. They need no app, and a change that makes them need one is
  the boundary breaking.
- `examples/showcase/`. An app, on the far side of the boundary. It depends on the
  package by name, and a test says nothing in the package reaches into `examples/`.
  Its own rules are in its CLAUDE.md.

`elements/` holds every custom element, and the file says which kind it is:
`export const shadow = true` for a shadow root, nothing for light. In `routes/`,
extension decides: `.html` is a page, `.js` is an endpoint.

An app owns `transclude.config.js`, its `worker.js`, its own tests, and `app/`
with the routes, elements and public files. The browser checks live
in `examples/showcase/app/routes/check.html`, because they need an app to run
against.

## Gotchas

- **`<template>` children are not `childNodes`.** They live on `.content`. Use
  `childrenOf()` from `codegen.js`. Walking `childNodes` sees nothing and says
  nothing.
- **`setHTMLUnsafe()`, never `innerHTML`.** `innerHTML` does not process nested
  declarative shadow roots; a child component becomes a dead `<template>`.
- **Empty type shapes must be `{}`, not `Record<string, never>`.** The second one
  carries an index signature, which makes every template typo legal. This was
  wrong in every component without a `<script state>` block and nothing failed.
- **The shim is `.js` on purpose.** JSDoc `@type` is honored in `.js` and
  ignored in `.ts`. Do not "clean it up" into TypeScript.
- **A shim diagnostic that does not map is dropped.** An error landing in
  generated scaffolding disappears. A check that passes very quietly usually means
  the position did not map, not that the code is right. This happened for real.
  TypeScript reports `TS1360: type '() => void' does not satisfy` at the
  `@satisfies` comment, which the shim generates, so a handler returning no
  `Response` type-checked and said nothing. `Builder.pin` exists for this: it
  emits generated text whose every offset maps to one source position. Use it for
  any annotation, not `add`.
- **A type name JSDoc cannot resolve is `any`, not an error.** The endpoint shim
  named `__Cookies` without emitting the typedef, so it checked nothing about
  cookies and said nothing. `COOKIES_TYPEDEF` is emitted by every shim whose
  context mentions it.
- **TypeScript ignores `@satisfies` on a function declaration.** Measured. It
  reports nothing. `export const GET = (ctx) => …` is typed from it;
  `export function GET(ctx)` is not, and gets a trailing `@type` assignment
  instead, which holds the return type but leaves the parameter untyped. So
  `export const` is the better spelling for a handler.
- **Report parse failures directly.** A syntax error in a `<script>` block used
  to surface as a confusing tsc error in a different file. `buildShim` records
  them with mapped offsets. Keep it that way.
- **Never bind twice.** Moving an element in the DOM reconnects it, and a second
  `bind` splits an already split text node. Guarded by `#bound`.
- **Directive values are expressions, not interpolations.** `each="tag of tags"`
  has no `${}`. Parse it as an expression or the volatile set is wrong.
- **Fragment mode emits components bare, and the flag has to reach all the way
  down.** A fragment is swapped into a live document, and nothing that swaps HTML
  processes declarative shadow DOM, so `shadow()` returns `''` and the element
  paints itself on connect. `__fragment` threads through both `emitShadow` and
  `emitLight`. Drop it from the second one and a shadow element inside a light one emits
  a shadow root nobody will process.
- **The form value is reported before the render, not after.** A form can be
  submitted between an attribute changing and the microtask that repaints, and what
  it sends has to match what the attribute already says, so `reportFormValue` runs
  at the top of `attributeChangedCallback`. It serializes the same way the
  attribute does, with objects as JSON, so what is submitted is what the DOM says
  rather than `[object Object]`.
- **`formResetCallback` removes the value attribute.** Setting it to an empty
  string would submit an empty string. Removing it is what makes the getter fall
  back to the default the `<script properties>` block declared.
- **`static formAssociated` can only be checked in a browser.** Nothing in Node
  models a form, so setting it to `false` broke no test until one read the flag
  directly. Whether a `<form>` counts it as a field is checked in
  `app/routes/check.html`.
- **`export const prototype` is hoisted out of `<script>`, and so is what it
  reads.** Members land on `Class.prototype`, shared by every element, while the
  rest of the block is `init`'s body and runs once per element. So a declaration
  changes lifetime by being read from the prototype. Reaching `host`, `shadow`,
  `signal` or `internals` from a member is a compile error rather than a value
  shared without anyone asking. `planLift` in `script.js` is the one place that
  analysis lives. The shim copies the same slices, so a change there needs the
  matching change in `emitMembers`, or tsc reports names the browser resolves.

- **A light element writes; only a shadow one rebuilds.** Both react to a prop
  change. The light one updates the text and attributes already in the document
  and never replaces a child, because it does not own its children: the caller's
  slotted markup sits among them and the page's script may hold them. So an `if`
  or an `each` over a value that changes is a compile error naming `shadow`. The
  guard reads `bindings.volatile`, which is what the compiler could *not* bind:
  with a boundary the same `each` compiles to a block with anchors and is written
  rather than rebuilt, so a shadow element's list is not volatile at all. Removing
  the guard failed no test until one was written for it. State is held to the same
  rule, because a volatile name is whatever the template read and not where the
  value came from.
- **State is behavior, so it defines the element.** Nothing observes state: its
  accessor is what schedules the write, the way an attribute change does for a
  prop. So a light element with a `<script state>` block and no `<script>` at all
  still has to be registered, or `el.n = 1` sets a value no node will ever hear
  about. `defined` in the compiler and the early return in `defineLight` are two
  spellings of one rule and have to agree.
- **`data()` is what a template sees, and the server has to build it too.**
  State defaults sit under the props. `shadow()` and `fragment()` rendered
  `def.coerce(props)` alone, so any template naming state wrote `undefined` into
  the page and the value only appeared once the element connected. This was wrong
  for shadow elements the whole time and nothing failed, because no test rendered
  one with state through the server. Props go on top of state in both places: put
  them the other way and the first paint disagrees with every paint after it.
- **Reacting costs a definition, and only a definition.** `defineLight` returns
  before registering unless there is behavior, members or form association, so
  `observedAttributes` costs a page nothing it was not already paying. The docs
  site still ships 0 client entries.

- **`baseApp` refuses an option it does not know.** `dev.js` passed `publicRoot`
  to a function that takes `publicFiles`, so dev served no public files at all
  while production served them. The only sign was a Vite warning about one of the
  three files. Two guards now: the unknown key throws, and a test reads both
  servers' source for `publicFiles` and `serveStatic`, because leaving the key out
  entirely is still legal.
- **Nothing here may import upward.** No `../../` and no `transclude.config.js`.
  Both were everywhere before:
  six files imported the config by relative path and four worked out the root as
  two directories up from themselves. That is true only while the package sits
  inside the app. Installed, two directories up is another package.
  `portable.test.js` checks module specifiers only, because `cookies.js` names the
  config file in an error message and should. A test that starts needing an app is
  the same boundary breaking from the other side: `production.js` loads whatever
  project it runs in, so its test writes a config into a temp directory.
- **An app has one port, and `PORT` beats the config.** `portOf` in `project.js`
  is the only answer, shared by `dev.js` and `production.js`, so dev and
  production listen on the same place rather than two. The default was 3000 and
  5173, which are the two most crowded ports on a developer's machine: a Next.js
  server someone else started answers on 3000 happily and looks exactly like
  yours. `PORT=` in a `.env` file reads as an empty string and `Number('')` is 0,
  which binds to whatever the OS hands out, so the value is checked rather than
  coerced.
- **A bin needs `#!/usr/bin/env node`.** Without it npm's `node_modules/.bin` entry
  is handed to the shell, which reads `import fs from 'node:fs';` as a command and
  hangs with no output. It only shows up once the bins are run as bins, which is
  what turning the directory into a package does.
- **A rename has to cover `dataset.x` as well as `data-x`.** `data-hf` became
  `data-transclude` everywhere and `s.dataset.hf` in `check.html` did not, so
  `adoptStyles` looked fine and one browser check failed. Nothing in Node models
  `dataset`, so the whole Node suite passed. The browser checks caught it.
- **Check that the listener is yours before believing a server test.** Three wrong
  diagnoses so far. "Something is listening on :1961" is not the check. A server
  someone else started, including the person you are helping, in their own browser,
  answers happily and serves an old `dist`, while your own `npm start` dies with
  `EADDRINUSE` into a log you did not read. Kill the port, wait for it to free,
  start, then confirm the listener is younger than the build:

  ```sh
  pid=$(lsof -nP -iTCP:1961 -sTCP:LISTEN -t); [ -n "$pid" ] && kill $pid
  for i in $(seq 20); do lsof -nP -iTCP:1961 -sTCP:LISTEN -t >/dev/null || break; sleep 0.5; done
  # start it, then:
  ps -o lstart= -p "$(lsof -nP -iTCP:1961 -sTCP:LISTEN -t)"   # vs. stat -f %Sm dist/server/entry.js
  grep -c EADDRINUSE <the server log>                          # must be 0
  ```
- **`<style data-transclude="tag">` in `<head>` is an agreement, not decoration.** It is
  the only record of which light elements the document already has styles for, and
  `adoptStyles` reads it with exactly that selector before adding any. Change how
  `renderDocument` writes it without changing the selector and a swapped-in light element
  quietly gets a second copy of its rules. `data-transclude-page` marks the page's own
  block, which is where an adopted one is inserted before. Appending would let an
  element override the page.
- **`define()` is transitive, and it is safe to call twice.** Both matter. An
  element found by the watcher has only itself to start from, and whatever it
  paints into a shadow root is out of reach of anything watching the document, so a
  module's `define` calls its children's. The `__defined` flag stops a cycle,
  because an element may render itself.
- **The swap watcher is opt-in, and used to follow `fragmentParam`.** Any app
  that could serve a fragment paid for the script whether or not a swap ever
  brought in an element, which is most of them: a page that renders its own
  elements defines them without it. `watchElements` in the config, off by
  default. The starter went from three client entries to none.
- **A listener on `document` outlives the element that added it.** One on `host`
  is collected with the element, so it needs nothing; one on `document`,
  `window` or `globalThis` holds its closure forever and every element after it
  adds another. `warnUnsignalled` in `script.js` reports a missing `signal` for
  those targets only. A boolean third argument is `capture` and counts as
  missing; a variable is left alone, because guessing would make the warning
  something to switch off.
- **One rule decides who ships a client entry, in `clientManifest`.** The dev
  server and the build both read `client.needed`. They each had their own copy of
  that condition once, and only one got updated, so dev served a page with no entry
  while the build gave it one.
- **An action runs after the region is known to exist.** `POST ?fragment=nope`
  used to change data and then 404. Anything that can refuse a request has to
  refuse it before `runAction`, not after. `hasRegion` is that check, in both
  servers.
- **A page's handlers are verb exports, the same as an endpoint's.** `export
  const POST`, and the same for PUT, PATCH and DELETE. They used to be an
  `actions` object, because `export const delete` is a syntax error and an object
  key is not, but `export const DELETE` is legal and endpoints already relied on
  that. `assertNoActionsObject` refuses a leftover `actions` export, because
  nothing reads one now and a page that kept it would answer 405 to every form
  and say nothing about why. The shim types each handler's `ctx` from the same
  route context as the loader, and adds `{ request: Request }`: the request is
  null only while prerendering, and prerendering never runs an action.
- **A verb is a name on a list, not a shape.** Both shims key on the methods the
  router really dispatches: `ACTION_METHODS` from `document.js` for a page,
  `ENDPOINT_METHODS` from `server.js` for an endpoint. The endpoint rule was
  `/^[A-Z]+$/`, so `export const LIMIT = 10` beside a handler was held to
  `Response | Promise<Response>` and reported as an error about correct code. The
  test meant to cover that used a lowercase helper, which the old rule already
  allowed, so it passed for as long as it was wrong. `runEndpoint` checks
  membership as well as shape: `mod.HELPERS` may well be a function, and a request
  naming it would otherwise reach it.
- **`ctx.response` is shared by reference, and has to be.** Loaders are called with
  `{ ...ctx, layout }`, so `ctx.status = 404` would be written to a copy nobody
  reads. `responseOf()` returns the one object every loader in the chain and the
  server all hold, which is why changing it works at all.
- **A loader returning a `Response` answers the request and skips the render.** It
  is the same rule an action already had, so there is one rule rather than two.
  When a layout does it, nothing below it runs, which is what makes a login
  redirect a layout's job.
- **`serve.js` registers every route, not just `manifest.dynamic`.** A prerendered
  URL is answered by the static handler before it gets there. What gets there is a
  URL the pattern matches but `paths` never listed. Leaving those to the not-found
  handler is what made dev answer 200 with the page's own "not found" body while
  production answered the 404 page. Different status and different body.
- **The order middleware is registered in is the behavior, so it lives in one
  function.** `baseApp` registers, in this order: the trailing-slash redirect,
  CSRF, `app/server.js`, the public-file handler, and then whatever routes the
  caller adds. Every position does a job. The redirect is first because it cleans
  up the URL everything else reads. `app/server.js` comes before anything that
  serves bytes, so a guard can cover prerendered pages and public files. Public
  files come before the route table, so a real file beats a `[...path]` catch-all.
  Both servers call the same builder, so there is no second copy of that order to
  get wrong.
- **Vite needs the http server, so the server is built first.** In middleware
  mode with no `hmr` option Vite starts its own WebSocket on port 24678, the
  browser refuses that socket as cross-origin, and nothing is ever delivered. The
  watcher still works and the terminal still prints `hmr update`, so the only
  place the failure shows is the browser, where `[vite] connecting...` is never
  followed by `connected.` and every edit needs a manual reload. `hmr: { server }`
  puts the socket on the page's own origin. With it, a CSS edit hot-updates and a
  page, element or layout edit reloads the tab, all from Vite.
- **Invalidate before `ssrLoadModule` in dev.** The file watcher and Vite's own
  invalidation are separate handlers on the same event, so loading first hands back
  the module as it was. Measured: the first edit to `app/server.js` was ignored and
  the second appeared to work.
- **`strict: false` and `trimTrailingSlash` exclude each other.** The loose router
  strips the slash from `c.req.path` before any middleware runs, so the redirect can
  never fire. Measured. `trailingSlash` is therefore one config key that sets both.
  `'never'` is strict routing plus a 301. `'ignore'` is the loose router and two
  URLs for one page. `alwaysRedirect: true` matters: without it Hono only redirects
  a request that already 404'd, and `/docs/:path{.+}` answers `/docs/intro/` as
  `intro/` with a 200 first.
- **`publicDir` is relative to `appDir`, like every other directory key.** It
  landed at the project root first, which put the one directory of site content
  outside the boundary the config's own opening line draws. A favicon in
  `app/public/`, which is where it belongs, was not served and nothing said so.
- **`app/public/` is copied to `dist/public`, and Vite's own `publicDir` is off.**
  Left on, Vite serves it in dev ahead of Hono and copies it into both the client
  and SSR outputs, and production served none of it. Dev 200, prod 404. Both
  servers now mount the same Hono `serveStatic`. Only the root differs, and
  production's is under `dist` so the stale-build warning stays true.
- **Public files are served by Hono, build output by the in-memory cache.** These
  are different on purpose. Build output is small, used often and never changes, and
  gets a strong ETag for each encoding. Public files belong to the author, can be
  large, and can be media. Media needs byte ranges, and the in-memory path answers
  200 where a 206 was asked for.
- **A `Response` that answers early still needs the envelope.** An action that sets
  a session cookie and then returns a redirect is an ordinary thing to write, and
  the cookie was dropped. The `Response` is returned directly and nothing looked at
  `ctx.response` on that path. `Response.redirect()` also has headers that cannot be
  changed, so appending throws rather than being ignored. `withEnvelope` copies with
  `new Response(body, response)`, which keeps the status and gives headers that can
  be written to.
- **`parseSigned` says `false` for a forged cookie, not `undefined`.** Absent is a
  missing key, present but invalid is `false`, and `?? fallback` would sail past the
  second one. `cookies.signed.get` turns both into `undefined`.
- **`cookies.all()` has a null prototype.** That is Hono's doing and worth keeping.
  A cookie named `constructor` is attacker input, and on a plain object it would
  collide with something real.
- **Only the dev server invents a cookie secret.** A fresh clone should run, so dev
  signs with a random value for that process and prints a notice. Production does
  not. A server that invented one would invalidate every session on restart and
  share none with a second instance, and a 500 naming `cookieSecret` is better than
  finding that out later.
- **The core has no `node:` imports and no Node-only globals, and both are tested.**
  `app.js` is given bytes, hashing and compression. `production.js` is the Node
  wiring. An import creeping in would be caught by the import graph test. A global
  would not, which is how swapping `TextEncoder` for `Buffer.from` broke nothing at
  first. There is a second test for `Buffer`, `process`, `__dirname` and `require`.
- **A header naming a region is a hint; the query parameter is strict.**
  `?fragment=nope` is a 404, because someone typed it. `HX-Target: nope` is ignored,
  because htmx sends that header on every request, including ones that want the
  whole document. Turning on `fragmentHeader` also adds a header to `Vary`, which is
  why it is off by default.
- **Strip comments before grepping source in a test.** Two of these guards failed
  on the comment that explains the rule rather than on code breaking it: the
  Node-globals check and the `process.env` one.
- **Use `fileURLToPath`, never `url.pathname`.** A space in the project path stays
  percent-encoded in the second one, and `Atelier%20Dakroub` is not a directory.
  That is how the extraction above broke on the first run.
- **`404.html` and `500.html` are reached for, not routed to.** Both are prerendered
  to files and sent as bytes. An error page that has to be rendered when a request
  has already failed can fail too. Production sends the 500 page with `no-store` and
  no ETag, because nothing about a failure should be cached or revalidated, and logs
  the throw without putting it in the body. Dev sends the stack instead, which is
  what you want when you are the one fixing it.
- **The directory holds routes; a page is one kind of route.** `routes/` was
  `pages/` until it started holding endpoints. Only the directory and its config key
  were renamed. `virtual:transclude-page/`, `pageModuleId` and the SSR entry's `pages`
  export still mean the `.html` kind, which is why `endpoints` sits beside it.
  `resolveRoutesDir` throws if the old name is still there, because the alternative
  is an empty route table and a site of 404s.
- **The framework ships nothing that swaps a region into a page, on purpose.** A
  region has a plain HTTP URL and that is the whole agreement. htmx, Turbo or a
  short `fetch` drives it. `watch` and `adoptStyles` are the exception, for one
  reason: they make somebody else's swap work, by noticing a tag that landed and
  loading its definition and styles. Adding a trigger attribute back would be
  building a second htmx, which was considered and rejected.
- **`hx-*`, `data-*` and `aria-*` are not props.** `PASS_THROUGH` in `shim.js`
  keeps them out of `emitComponentProps`, or `hx-get="/x?id=${id}"` on a component
  is a type error for a page that works. They are still checked as expressions.
  Only the claim that the name is declared goes away. The regular expression needs
  the trailing dash: `database` is not `data-`.
- **How an element renders is read from the file, before anything is compiled.**
  `shadow` used to be the directory a file sat in, which the scan knew for free.
  Now `plugin.js` calls `readFlags` on every element first, because how a tag
  renders decides how every *other* file that mentions it compiles: `shadowTags`
  is passed to every page, layout and element compile. Read it lazily and a page
  compiled before its element would emit the wrong thing for that tag, with
  nothing said. `readFlags` and `compileComponent` share `ELEMENT_FLAGS` and the
  same extractors, so there is one answer to what a file declares.
- **`loadProject` refuses `partialsDir` and `componentsDir`.** Both are one
  `elementsDir` now. Left alone the old keys would be ignored, the app would look
  in `app/elements/`, find nothing, and every tag would render as an unmatched
  custom element with no styles and no error. Same guard as the old `pages`
  directory name.
- **`<html>` is read with a second parse, because the fragment parser drops it.**
  A nested html start tag cannot appear in a body, so `parseFragment` throws it
  away attributes and all, and it never reaches `emitElement`. `splitBlocks`
  parses the source again in document mode purely to read that element. Using the
  real parser rather than searching the text is what makes `<html>` inside a
  script block or a comment stay a string.
- **`renderHtmlAttrs` returns an object, not markup.** The chain merges by name,
  innermost winning per attribute, so a root layout setting the theme and a page
  setting `dir` both survive. Concatenating serialized attributes instead would
  put two `data-theme` in one tag, and the parser takes the *first*, which is the
  outermost, which is backwards. `renderDocument` serializes once. Values are
  escaped with the same four characters `attr` escapes in the runtime, because a
  theme comes from a cookie. Names are checked against a pattern rather than
  escaped: a name needing an escape is a mistake and should say so.
- **An endpoint's `Response` goes through the envelope too.** Every other path
  wrapped one and this did not, so an endpoint that set a cookie and answered a
  redirect lost the cookie. The redirect worked, which is what made it hard to
  see. Found by writing an endpoint that stores a preference and sends you back,
  which is the shape that hits it.
- **A feed reads no clock.** `src/feed.js` stamps the document from the newest
  item it holds, and takes `updated` from the config when there is none. A
  prerendered feed is a file, written once and compressed once, so a build-time
  `new Date()` would change the bytes on every run for a feed whose contents did
  not change, and every ETag with them. Atom requires both an author and a date,
  so it refuses rather than inventing either.
- **`]]>` has to be split, and it turns up in ordinary code.** A CDATA section
  cannot hold that sequence, and `<script>if (a[b[c]]>0)</script>` is markup
  someone will put in a feed item. Writing it as two sections is what a parser
  puts back together as the three original characters.
- **`prerender` is read off the page, never off its layouts.** `build.js` checks
  `pages[route.id]?.prerender`, so a layout that reads the request makes every
  page under it request-dependent and nothing says so. The prerendered ones are
  written with no request and quietly render whatever the default is. A theme
  read from a cookie in the root layout is the case that shows it: half the site
  honours the cookie and half serves a file, and both look fine on their own.
- **The CSP is hashes, not a nonce, because a prerendered page is a file.** A
  nonce has to be fresh per request, so a page carrying one cannot be written
  once and compressed once, and every prerendered page here is exactly that.
  Swapping a nonce into the body on the way out would mean decompressing and
  recompressing every response, which is the whole point of `dist` gone. A hash
  is fixed when the page renders, survives being written to disk, and is
  correct on a host that has never heard of this framework. `withPolicy` runs in
  `renderRoute`, after the document exists, because the policy is built from what
  the document inlined.
- **A hash never covers a `style` attribute, so `style-src` is not hashed.**
  Hashing `<style>` blocks worked, the policy named every one of them, and the
  docs site lost all its syntax colors: shiki puts `style="--shiki-light:…"` on
  every token, and a hash in `style-src` applies to blocks only. `'unsafe-inline'`
  does not rescue it either, because a directive carrying any hash *ignores*
  `'unsafe-inline'` outright. The two exclude each other, so the default hashes
  scripts and leaves styles inline. CSS cannot run code; script is where the
  protection is. Checking that the policy covered every inline block was the
  wrong check, and it passed.
- **`csp.js` uses `crypto.subtle`, not the injected `hash`.** That one is an
  ETag, documented as a cache key and not a signature, and `portable.test.js`
  hands it a fake that returns a length. A CSP hash the browser does not agree
  with means the script is refused, so this needs a real digest. `crypto.subtle`
  and `btoa` are globals on all four runtimes, so the core keeps its no-`node:`
  property.
- **Reading a cookie is what makes a page personal, not writing one.** The cache
  first refused to hold a page whose loader set a header, which is the rule the
  build uses to decide a route can be a file. It is not enough. `/notes` renders
  "you have added N of these" from a cookie it only *reads*, sets nothing, and
  was cached: the next visitor got the first one's count. `cookiesOf` records the
  read and `cacheable` checks it. The unit test for the flag passed the whole
  time; only a request through `createApp` catches this.
- **Three servers render pages, so the include context is built in one place.**
  `src/app.js`, `bin/dev.js` and `bin/build.js` each render, and each was handed
  its own resolver. Dev got the external half and not the route half, so
  `<transclude src="/x#y">` worked in production and threw in dev with
  nothing to suggest why, and the build had the same gap waiting behind a
  server-rendered page. `includeContext` in `src/include.js` answers it for all
  three, and a test reads all three files for the call. This is the same shape as
  `clientManifest` deciding who ships a client entry, and it broke the same way.
- **Building the include context is half of it. Every render call site has to be
  handed it.** All three servers built one and only `renderRoute` was given it,
  so a page holding any include served its whole document and answered 500 for
  every one of its regions: `/` was 200 and `/?fragment=matches` threw "no way to
  reach one". Three call sites had the same omission, `src/app.js` twice for GET
  and for the render after an action, and `bin/dev.js` once. The source-reading
  test above could not see it, because every one of those files does call
  `includeContext`. Only a request through `createApp` reaches it, which is the
  same lesson as the cookie cache flag. `renderFragment` makes its own
  `includeMemo` for the reason `renderRoute` does.
- **An included route reads cookies through the host's, and that is the point.**
  The cache refuses to hold a page whose loader *reads* a cookie, and a route
  include is a second loader running inside the first page's render. Giving it
  its own `cookiesOf` would make the host look shareable, and the second visitor
  would be handed the first one's page. Sharing the object makes the read
  contagious for free. The build refuses to prerender a page whose
  `ctx.cookies.personal` came out true, whether the page read one or something
  it includes did.
- **One route included twice renders once, and the memo dies with the request.**
  `includeMemo` is created in `renderRoute` per call. A store that outlived the
  request would be a second page cache with none of the rules the real one has,
  and it would serve one visitor's render to the next.
- **A route include is rendered, not fetched.** It is the same process. Asking
  ourselves over HTTP would run the whole middleware stack, take a second trip
  through CSRF and the trailing-slash redirect, and need a URL the server can
  reach, which behind a proxy it may not know. `paramsFor` answers what the
  router would have said, for the two pattern shapes a route can have.
- **The loop guard is a chain, not a counter.** A page including itself is caught
  by name, so the error can say the way round; ten pages each including the next
  is not a loop and is caught by depth. Both are needed and neither finds the
  other's case.
- **An external include is resolved before the render, because render is
  synchronous.** Every render function down to the last component is
  `__o += …` string building, and a fetch is not that. So the compiler collects
  what a page declares into `export const externals` and `renderRoute` has the
  answers ready before it calls render, keyed by the src string. That is also
  what lets a prerendered page carry one: it reads the source once at build time
  and is still a file. Making render async instead would have taxed every
  component call for a feature few pages use.
- **A src that is interpolated cannot be an include.** The set has to be known
  before the render that would produce it, so `src="/docs/${slug}#a"` is a
  compile error rather than a value nobody could resolve in time.
- **An included region drops its id, and the region keeps it.** A region is
  always rendered where it is declared, so `<transclude src="#id">` is
  always a second copy in the same document. Both carrying the id would be
  invalid HTML, and worse: a swap aimed at `#id` finds whichever came first and
  leaves the other stale. The region's root id is emitted as
  `__named ? ' id="x"' : ''`, the page's render declares `__named = true`, and
  the include calls the region function with `false`. The fragment served over
  HTTP keeps the name, because that is what a swap is matched against. This was
  shipped as a warning first, which was wrong: the warning fired on every use.
- **`<transclude>` has no dash, and that is only safe because it never reaches
  the browser.** The compiler consumes it: every form is resolved server-side and
  the tag leaves no trace, so it does not need to be a valid custom element name.
  Two things follow. An app cannot define one, because `elements/` drops any file
  whose tag has no dash. And an undashed tag reads like it might be void, so
  `<transclude src="#a" />` is the mistake people will make: HTML has no
  self-closing tag here, `/>` is read as `>`, and since the children are the
  fallback the rest of the page becomes them. Silent, and the include still
  works. `sourceCodeLocation.endTag` is absent exactly in that case, which is
  what the guard reads.
- **`transclude` is read before the component table.** An app defining
  `elements/transclude.html` would otherwise shadow the include, and a
  page using it would compile to something else entirely with nothing said.
- **The proxy follows redirects itself, and that is the point.** `redirect:
  'follow'` hands the whole decision to the first response: the check that passed
  on the URL somebody configured says nothing about where hop three landed, and
  a redirect to `169.254.169.254` is the standard way in. `fetchChecked` loops
  with `redirect: 'manual'` and re-runs the allowlist and the address check on
  every hop.
- **Resolving a name is injected, because one runtime cannot do it.** `address.js`
  decides what an address *means* and imports nothing; `lookup.js` turns a name
  into addresses and imports `node:dns`. The core reaches the first and never the
  second, which `portable.test.js` now asserts by name. On workerd there is no
  resolver at all, so the allowlist is the whole defense and the docs say so
  rather than implying the address checks are running everywhere.
- **Sanitize, then rewrite, then index.** The base is read before `<base>` is
  stripped, cleaning happens before rewriting so nothing rewrites a URL on an
  element about to be removed, and the id table is built last. Indexing first
  leaves the table naming elements the cleaning took out, so `listFragments`
  advertises a fragment that then fails to resolve.
- **`<base>`, `<link>` and `<style>` are stripped from foreign markup for the
  host page's sake, not the fragment's.** None of them stops at the fragment. A
  `<base>` retargets every relative URL in the document the fragment is inserted
  into, a `<link>` can pull a stylesheet from anywhere, and a `<style>` block is
  unscoped CSS: `p { display: none }` from the source empties the page it lands
  in. `<style>` was missed at first, which left the `<link>` rule half applied.
  A `style` attribute is the other kind and is kept, because it paints one
  element; `proxy.styles: 'strip'` drops those for an app that wants its own
  look. The value is checked, since a misspelling would keep every attribute and
  read exactly like the setting working.
- **`src/extract.js` never runs on our own pages.** A region here is compiled:
  `<div id="x" fragment>` becomes its own render function and the same markup
  serves it inline and alone, so nothing in that path parses HTML. `extract.js`
  is for a document somebody else wrote, where there is no attribute to read and
  no compiler output to reuse. Pointing it at a page of ours would be a second
  fragment system that disagrees with the first about what an id returns.
- **The slug table is built for the whole document, once.** Working a heading's
  slug out on demand would make the suffix depend on which fragment was asked
  for, so `#notes-1` would name different headings on different requests.
  Explicit ids are all reserved before the first slug is handed out, which is why
  an id further down the document still beats a heading further up.
- **Template content is not addressable, and `childNodes` is why it looks like it
  is.** A `<template>`'s children live on `.content`, so a walk over
  `childNodes` finds nothing and an id inside one silently resolves to null. That
  is the behavior we want here, but for a reason worth stating: the content is
  inert, so a URL returning it would return markup the source document never
  showed. `kidsOf` returns `[]` for a template on purpose rather than by
  accident.
- **A literal `${` cannot be written in a template.** There is no escape for it.
  The compiler reads every one as an interpolation, so `${}` in prose fails with
  `bad expression "": empty expression` and a line number in the compiled file
  rather than the source. Anything documenting the syntax has to pass its
  examples in from the loader, where a JS string can hold them. That is what
  `docs/` does, and it is why its code samples are data rather than markup.
- **A `file:` dependency does not bring its peers.** npm installs a peer
  dependency alongside a package from the registry, so `npm install transclude`
  gets Vite and TypeScript. It does not do that for `file:..`, which is how both
  apps here depend on the package. So `examples/showcase` and `docs` each list
  Vite and TypeScript again in their own `devDependencies`. Those entries look
  redundant and are load-bearing. Measured both ways: from a tarball both land,
  from a path neither does.

## Testing

The rule the tests are built on: **after `bind` and `update`, the DOM must
serialize to exactly what a full render of those props produces.** One assertion
catches index errors, bad splits, escaping drift and missed attributes.
`test/dom.js` is a parse5-backed DOM to run it in Node.

Falsify before trusting. Break a mechanism on purpose and confirm only its own
tests fail. Several gaps in coverage were found exactly this way.
