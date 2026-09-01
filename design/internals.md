# Internals

How this repository is put together, and what has broken in it before. The
gotchas are the useful half: nearly every one was written after something failed
quietly, and each says what the failure looked like so the next person recognizes
it. `design/voice.md` covers how anything here is written.

## Writing code here

The reader is someone tired, at night, who did not write this. Everything below
follows from that. Most of it is [grugbrain.dev](https://grugbrain.dev) applied
to this codebase.

**Name the steps.** A condition with three clauses gets three names, and the
`if` reads as a sentence. The same goes for a value built by four chained calls:
give the middle one a name and let the next line use it. A debugger can stop on a
named line and cannot stop inside an expression.

**One `?` per line.** A ternary inside a ternary is a table written sideways.
Write the table, or write `if`.

**Repeat yourself before you build a mechanism.** Two copies of six plain lines
cost less than one clever thing that serves both. The rule is about knowledge,
not characters: two pieces of code that look alike and change for different
reasons were never one piece.

**Wait for the shape.** An abstraction invented before the third case is a guess,
and the guess sets the shape everything after it has to fit. Three call sites
that agree are the signal, not two that might.

**Keep behavior together.** A page's loader lives in the page. The reason this
framework exists is that reading one file should answer what one thing does.

**Small steps, green at each one.** A refactor that cannot be stopped halfway is
a rewrite. Run the tests between steps, and keep the working state one commit
away.

**Say no.** The cheapest complexity is the kind never added. A feature refused is
a decision, and it belongs in `/docs/decisions` so it is refused once.

**Say when it is too much.** Code nobody can follow is a fact about the code. If
a function cannot be read in one pass, that goes in a comment or a gotcha rather
than into the next reader's evening.

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
- `src/vite.js`. The one import of `vite`, which is an optional peer. Not the
  plugin: that is `plugin.js`.
- `src/prerender.js`. What a page may be if it is going to be a file, and the
  `ctx` the build hands it. Split out of `bin/build.js` because nothing can
  import that: it runs a build the moment it is loaded, so anything left in it
  is testable by hand only. Put logic worth checking here, and keep that file
  to wiring.
- `examples/showcase/scripts/coverage.js`. Drives the same checks
  `browser.js` does, through the DevTools protocol, and reads V8's precise
  coverage back. The only way to learn what the browser half runs. Against the
  dev server, so an offset is a line in a file somebody can open.
- `scripts/smoke.sh`. Serves a built app on one runtime and asks it for a page.
  The only thing here that runs Bun, Deno and workerd; `ci.yml` calls it once
  per runtime.
- `tsconfig.types.json`. Emits the published declarations from the JSDoc into
  `types/api`, which is committed because nothing builds at publish time.
  Separate from `tsconfig.src.json` because that one checks and emits nothing.
  `npm run types` after changing a signature, or the test says so.
- `test/`. They need no app, and a change that makes them need one is
  the boundary breaking.
- `examples/showcase/`. An app, on the far side of the boundary. It depends on the
  package by name, and a test says nothing in the package reaches into `examples/`.
  Its own rules are in `examples/showcase/design/internals.md`.

`elements/` holds every custom element, and the file says which kind it is:
`export const shadow = true` for a shadow root, nothing for light. In `routes/`,
extension decides: `.html` is a page, `.js` is an endpoint. `icons/` holds one
SVG file per icon, and `src/icons.js` compiles the directory into the single
`/icons.svg` a `<use href>` points at.

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
  wrong in every component that declared no `state` and nothing failed.
- **The shim is `.js` on purpose.** JSDoc `@type` is honored in `.js` and
  ignored in `.ts`. Do not "clean it up" into TypeScript.
- **`transclude-check` drives TypeScript 7, and refuses anything else by
  name.** The 7 package exports two names from its main entry; the compiler is
  a Go child process behind `typescript/unstable/sync`, and `typecheck.js` is
  the one file in `src/` that imports it, so a move in a 7.x minor is one file
  to follow. The import and its shape are both checked by `refuseMovedAPI`,
  because a renamed flag is the quiet break: an undefined bit ORs into
  `TYPE_FORMAT` as nothing and types print wrong without a word. The refusal
  names what moved and the pinned version that held still. Four differences crossed the port. A diagnostic's chained reasons
  arrive structured rather than flattened, so `flatten` joins them, or every
  "not assignable" loses its because. Qualified type names print
  single-quoted, so `QUALIFIED` accepts either quote. Union order in a message
  is the compiler's, not the source's: `Response | Promise<Response>` prints
  reversed, and three tests assert 7's order. And a `let x = null` that a
  closure reads is no longer an evolving type, which is how the showcase's
  checks endpoint earned an annotation 5.9 never asked for. The compiler being
  a child process is why `createChecker` has `dispose` and `bin/check.js`
  calls it: without that, the exit waits on an orphan.
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
- **The shim's globals come from `expr.js`, and used not to.** Two lists of the
  same names, written out separately, drifted: `json` was in the compiler's and
  not the shim's. So `${json(rows)}` compiled, rendered the right bytes, and then
  failed `npm run check` claiming `json` was not a field of the page's data. The
  shim already declared it as a parameter of `__template`; only the rewrite did
  not know, so it emitted `__d.json(...)` against a name sitting right there in
  scope. Worse than a missing feature, because the compiler's own raw-text error
  tells the author to reach for `json()`: follow the advice, get a type error.
  `GLOBALS` is now `expr.js`'s set plus the three literals acorn hands back as
  identifiers, and a test walks every name in it. Nothing in this repo uses
  `json()` as live markup — it appears only inside code samples, which are
  strings — so `transclude-check` on `www` could not have caught it.
- **Report parse failures directly.** A syntax error in a `<script>` block used
  to surface as a confusing tsc error in a different file. `buildShim` records
  them with mapped offsets. Keep it that way.
- **Never bind twice.** Moving an element in the DOM reconnects it, and a second
  `bind` splits an already split text node. Guarded by `#bound`.
- **`createElement` cannot express a namespace, and the parser will not enter one
  without a real tag.** A re-render parses its new markup inside a scratch
  element of the destination's kind, because a bare `<tr>` in a `<div>` is thrown
  away. For an `<svg>` parent that scratch element was
  `document.createElement('svg')`, which is an HTMLUnknownElement in the HTML
  namespace: the parser never enters foreign content inside one, so every `<g>`,
  `<use>` and `<circle>` parsed there came back HTML. They are in the document,
  they carry the right attributes, and they draw nothing. The first paint always
  looked right, because that one arrives through `setHTMLUnsafe` on the shadow
  root, where the parser does see a real `<svg>`. Only a block rebuilt afterwards
  vanished, and an item the keyed walk reused kept its good node, so it presented
  as "some of them draw". Reported from an app, confirmed in Chrome, and MathML
  had exactly the same bug. `holderFor` answers with a tag to create and a tag to
  wrap the markup in: foreign markup goes into a written-out `<svg>` or `<math>`
  inside a div, and that wrapper is what the caller walks. Two traps around it.
  The wrap is refused at an HTML integration point, which is `<foreignObject>`,
  `<desc>`, `<title>` and an `<annotation-xml>` whose `encoding` says HTML. Those
  children are HTML again, and an HTML start tag inside foreign content takes the
  parser *out* of the `<svg>`, so wrapping them does not fix a block, it empties
  one: the first patch tried crashed the whole check page on a node it did not
  have, rather than losing one region. And the namespace table is a `Map`,
  because `createElementNS('constructor', 'x')` is a thing somebody can write.
  Nothing in Node models any of this. `test/dom.js` has no `namespaceURI` at all,
  so all 1,287 Node tests passed for as long as it was broken:
  `test/namespaces.test.js` holds the decision, and the browser checks hold what
  a browser does with it.
- **Directive values are expressions, not interpolations.** `each="tag of tags"`
  has no `${}`. Parse it as an expression or the volatile set is wrong.
- **Fragment mode emits components bare, and the flag has to reach all the way
  down.** A fragment is swapped into a live document, and nothing that swaps HTML
  processes declarative shadow DOM, so `shadow()` returns `''` and the element
  paints itself on connect. `__fragment` threads through both `emitShadow` and
  `emitLight`. Drop it from the second one and a shadow element inside a light one emits
  a shadow root nobody will process.
- **A module variable does not bridge the two bundles.** An app holding `env`
  from `worker.js` for its loaders has to keep it on `globalThis`, because the
  build inlines a copy of that module into `dist/server/entry.js` and wrangler
  bundles `worker.js` with a second one. Written as `let current`, `hold` set one
  copy and `bindings` read the other. The failure is quiet in the worst way: the
  form answered, the reader was told to check their inbox, and the row went to a
  dev fallback instead of D1. Found on the live site, not in a test. The
  runtimes page and the skill both teach the symbol now.
- **A `<script>` with a non-JavaScript type is markup, not a client block.**
  `splitBlocks` reads anything without a marker as client code to compile, which
  swallowed every data block: JSON-LD, import maps, hand-written speculation
  rules, a hyperscript `behavior`. `isDataBlock` sends those to `nodes` for the
  same reason a `src` goes there, and the JS list is `''`, `module`,
  `text/javascript`, `application/javascript`. Widening it until `module` matched
  would stop every client block in a project from compiling, which is what one
  falsification does on purpose. Interpolation into one is still refused by
  `assertRawTextSafe`, since being markup does not make raw text safe.
- **The dev server builds its own `ctx` too, and `test/context-shape.test.js` is
  what notices.** `ctx.after` shipped in 0.7.0 and was undefined in dev, so a form
  calling it worked in the build and threw `after is not a function` while you
  were writing it. `revalidateTag` had been the same since it was added. Four
  files carry the field list: `src/app.js`, `bin/dev.js`, `src/prerender.js` and
  the literal in `src/typecheck.js`. Adding a field means all four and the list in
  that test. It is a text check, because `bin/dev.js` starts a server when it is
  imported and nothing can build its context and look. It reads the files with
  comments stripped, since the first version was satisfied by prose containing
  the word "after".
- **The check ran one direction, and the type promised a field for three
  weeks.** `ctx.htmlAttrs` stayed in `contextLiteral` after the commit that
  removed the feature, so every generated project's type said the field existed
  and every read of it was `undefined` that type-checked clean. The shape test
  only asked whether the literal held everything the servers build, never
  whether it held more. It asks both now, and the twelfth field it blessed on
  the way is `layout`: real, typed, spread in by `document.js` per loader
  rather than built in `contextFor`, and documented on the routing page's
  context table with the other eleven.
- **The dev server mounts its own routes, so `createApp` is not the only list.**
  `bin/dev.js` builds a Hono app with `baseApp` and registers what it needs.
  Anything `createApp` mounts from config has to be added there too, or it works
  in the build and 404s in dev, which is the direction nobody checks. `/feed.xml`
  and `/sitemap.xml` were missing for as long as the config keys existed, and the
  proxy route with them. `/precache.json` is the exception and stays one: it
  names hashed filenames only the build knows. Adding a config-driven route means
  touching both files.
- **Config defaults are applied in `createApp`, not in `loadProject`.** They used
  to be in `project.js`, which reads a disk, so only Node ever applied them. A
  worker imports `transclude.config.js` and hands over exactly what the author
  wrote, so every key they left out was undefined on the one runtime the docs
  recommend deploying to. `fragmentParam` undefined reads as "no parameter
  configured", so `?fragment=` was answered with the whole document, and a swap
  wrote a second copy of the page into the element it should have replaced. It
  looked like a compiler bug for as long as anyone looked at the compiler. Seven
  of the nine examples were shipped that way; `www` and `showcase` were fine only
  because their configs happen to set the key. `DEFAULTS` lives in `defaults.js`
  now, which imports nothing, and `withDefaults` runs on the first line of
  `createApp` so no entry can skip it.
- **`draft` is filtered out of `manifest.routes` once, and the manifest is
  reassigned.** Three steps in `bin/build.js` read that list: the render pass,
  the sitemap and `routes.json`. Carrying the published routes alongside the
  manifest would leave a fourth one added later publishing drafts, so the filter
  replaces the list rather than sitting beside it. The dev server never sees any
  of this: it scans the directory, which is what makes a draft previewable and is
  the whole point. That is a deliberate dev-versus-production difference, in a
  file that has had three accidental ones, so the build prints what it skipped
  under everything it wrote. A page missing from production and silent about it is
  the failure this feature would otherwise create.
- **The build's context refuses rather than omits.** `revalidateTag` and `after`
  are on the prerender context as functions that throw. Leaving them off is what
  it did before, and a loader calling one failed with `revalidateTag is not a
  function`, which names neither what the page did nor how to stop. Both are in
  the generated type either way, because the checker cannot know which pages
  become files. All six refusals live in `src/prerender.js` rather than in
  `bin/build.js`, for the reason below.
- **The cache's own background work forgot `after`, which is the rule `after`
  exists for.** `src/after.js` says it in its first paragraph: workerd may stop
  the isolate when the response is sent, and work nothing holds stops with it.
  `src/cache.js` then wrote `refresh(...).catch(() => {})` behind a stale
  response and held nothing. Two failures follow. The rebuild never happens, so a
  revalidating page is permanently stale on Cloudflare and correct on the other
  three. And the `finally` that frees the key never runs, so `inFlight` keeps a
  promise that will never settle, and any later request reaching the *miss* path
  waits on it for as long as the isolate lives. The stale path does not await, so
  expiry alone does not hang: the store entry has to be gone as well, which
  `revalidateTag`, `revalidatePath`, eviction at `max`, or a render that stopped
  being cacheable all do. Found on a deployed site, not here, because nothing in
  this repository runs on workerd. `read` takes the request's `after` now, and
  `ABANDONED_MS` bounds how long one unfinished render may hold a key.
- **`ctx.after` catches the rejection before `waitUntil` sees it.** Nothing awaits
  the work, so an unhandled rejection ends the process on Node. `after.js` hands
  `waitUntil` the already-caught promise, not the original, or workerd logs the
  same failure a second time on its own. The `try` in `executionCtxOf` covers
  Hono's getter and nothing else: it throws when the runtime has no
  ExecutionContext rather than answering undefined, and widening the `try` over
  the `waitUntil` call would swallow a real failure. A test asserts each of those
  three separately, because any one of them passes while the other two are wrong.
- **`contextFor` names no runtime, and that is why it has no `env`.** A loader is
  handed `ctx` from `app.js`, which the no-`node:` test keeps portable. Hono has
  `c.env` right there and it is tempting to forward: do not. It is the bindings on
  workerd, `{ incoming, outgoing }` under `@hono/node-server`, and the server
  object on Bun. One property, four meanings, and a loader written against it
  typechecks everywhere and runs in one place. An app reaching a binding holds
  `env` in its own module from its own `worker.js`, which also types it properly,
  because the app knows what is in there and the framework does not. Documented on
  `/docs/runtimes`.
- **The form value is reported before the render, not after.** A form can be
  submitted between an attribute changing and the microtask that repaints, and what
  it sends has to match what the attribute already says, so `reportFormValue` runs
  at the top of `attributeChangedCallback`. It serializes the same way the
  attribute does, with objects as JSON, so what is submitted is what the DOM says
  rather than `[object Object]`.
- **`formResetCallback` removes the value attribute.** Setting it to an empty
  string would submit an empty string. Removing it is what makes the getter fall
  back to the default `export const properties` declared.
- **`static formAssociated` can only be checked in a browser.** Nothing in Node
  models a form, so setting it to `false` broke no test until one read the flag
  directly. Whether a `<form>` counts it as a field is checked in
  `app/routes/check.html`.
- **Nothing is hoisted out of `<script element>`, and that is the design.** The
  block is a module: what the author wrote at the top level stays at the top
  level, in the order they wrote it, and only the six reserved names are rebound
  in place. `bindElementModule` in `script.js` pads every splice with spaces, so
  a line and column in the generated module is that line and column of the .html
  file. This replaced a transitive dependency walk (`planLift`) and a per-element
  reach check, both of which existed only because a `<script>` body had four
  names injected into it that a hoisted member must not see. With no injection
  there is nothing to check: `this` is the element, and a bare `host` is a free
  name that tsc already reports.
- **`connected`, `disconnected` and `updated` are members the framework calls.**
  No class can declare them, because a class field is an own property set in the
  constructor and would shadow the prototype member `defineMembers` installed.
  So the runtime reads them through `hooks(this)`, which is the one line that
  says what shape the framework expects. `connected` and `disconnected` both run
  on every connect and disconnect rather than once, because moving an element is
  both; the `AbortSignal` is per connection, so a moved element gets a fresh one.
- **Every export in `<script element>` declares one name, and `splice` works
  back to front.** Two branches read a statement, and only one of them asked how
  many declarators it had: `export const properties = {…}, shadow = true` matched
  the flag, blanked the statement whole, and dropped `properties` in silence, so
  the element coerced no attributes and a template read the raw string. Asking
  once, before either branch, removes the question rather than answering it
  twice. `splice` used to promise length and now promises lines: `export const
  state=` is nineteen characters and `const __stateDefs = ` is twenty, so legal
  code failed to build over one character. A replacement may now be longer than
  what it replaced, which is why the cuts are applied in descending order — the
  offsets all came from the original, and rewriting front to back leaves each
  later cut off by however much the ones before it grew.
- **A prop or a state field cannot be named for a member the framework calls.**
  `defineProps` puts an accessor on the prototype where `connected` belongs, and
  `defineMembers` catches nothing, because it checks a member against what the
  element already has and there is no member here. The runtime then calls what
  the attribute holds, which is a string. `assertNoHookShadow` refuses the name
  where it is declared. `RESERVED_LIFECYCLE` is the other half of this and covers
  the `*Callback` spellings on the prototype itself.
- **A synchronous cleanup runs synchronously, and that is load-bearing.**
  `release` handed every cleanup to `Promise.resolve().then()`, so it was
  deferred by a microtask even when it was already a function. Moving an element
  is a disconnect and a connect in one task, so the first connection's cleanup
  ran *after* the second `connected` had set everything up, and tore down what it
  had just built. Nothing reported it, and no test looked until `disconnected`
  needed an order that could be written down. That order is: abort the signal,
  run what `connected` returned, then call `disconnected`. An `async connected`
  is the exception nothing can fix, because its cleanup is a promise.
- **The reserved names are not module-scope declarations.** They are rebound or
  blanked before the generated module is assembled, so `bindElementModule`
  filters them out of `declared`. Without that filter `export const
  formAssociated` collided with the module's own `formAssociated` export, which
  is the very name the block is meant to use.

- **A light element writes; only a shadow one rebuilds.** Both react to a prop
  change. The light one updates the text and attributes already in the document
  and never replaces a child, because it does not own its children: the caller's
  slotted markup sits among them and the page's script may hold them. So an `if`
  or an `each` over a value that changes is a compile error naming `shadow`. The
  guard reads `bindings.volatile`, which is what the compiler could *not* bind:
  with a boundary the same `each` compiles to a block of its own and is written
  rather than rebuilt, so a shadow element's list is not volatile at all. Removing
  the guard failed no test until one was written for it. State is held to the same
  rule, because a volatile name is whatever the template read and not where the
  value came from.
- **Both halves fence a block. Only the shadow half compiles one.** `anchored()`
  and `standalone()` in `codegen.js` are two questions, and they were one until
  the answers had to differ. A light element is compiled as a layout, where
  `<slot>` is a compile-time hole reading `__slots`, a parameter of `render` that
  a module-scope block function would not have. So its blocks stay inline, which
  is `standalone()`. The walk that binds the nodes *after* a block still has to
  know where the block ends, and only the anchors say, which is `anchored()`.
  While the two were one, everything from the first `if` to the end of a light
  element's template was volatile, so `<p if="true">fixed</p><span>${name}</span>`
  was refused over a name the block never read.
- **A `<slot>` is as wide as the caller says.** It is fenced for the reason a
  block is. A light element's slot renders what was passed to it, which is no
  nodes or twenty, and the binder counted it as one: with two nodes slotted in,
  the update wrote the element's own text into the caller's second node and left
  its own alone. Nothing failed, because no test slotted markup into an element
  that also bound something after the slot.
- **The tag tells a fenced hole from a bare block.** `anchoredOf` holds both, and
  a branch reaches its own part *bare*, with its directive already consumed, so a
  block's node arrives at the walk as an ordinary element and is in that set.
  `isHole` asks for `<slot>` as well. Asking the set alone steps over every shadow
  branch instead of binding it, which is 17 tests.
- **State is behavior, so it defines the element.** Nothing observes state: its
  accessor is what schedules the write, the way an attribute change does for a
  prop. So a light element that exports nothing but `state` still has to be
  registered, or `el.n = 1` sets a value no node will ever hear about. Three
  places ask that question, and `readBehavior` in the compiler is the one reader
  all three go through: `defined` in the compile, `hasScript` in the plugin and
  `upgrades` in the type extractor. The early return in `defineLight` is the
  fourth spelling and has to agree with it.
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
- **A listener on `document` outlives the element that added it.** One on the
  element is collected with it, so it needs nothing; one on `document`,
  `window` or `globalThis` holds its closure forever and every element after it
  adds another. `warnUnsignaled` in `script.js` reports a missing `signal` for
  those targets only. A boolean third argument is `capture` and counts as
  missing; a variable is left alone, because guessing would make the warning
  something to switch off.
- **One rule decides who ships a client entry, in `clientManifest`.** The dev
  server and the build both read `client.needed`. They each had their own copy of
  that condition once, and only one got updated, so dev served a page with no entry
  while the build gave it one.
- **The two element classes are duplicated on purpose, and a test holds them
  together.** `defineLight` and `defineComponent` each carry their own
  `schedule`, `updateComplete`, `reportFormValue`, `#data`, `#snapshot` and the
  rest: nine methods that are identical today. A shared base class would put
  indirection into the one file that ships to a browser, so the copies stay and
  a test compares them instead. Only `connectedCallback` and `#apply` may
  differ, and those two *are* the difference between the halves: a light element
  writes into nodes that are already there, a shadow one may rebuild. Changing
  one half's `schedule` and not the other fails that test even when the change
  behaves identically.
- **A test that loops over the thing it checks proves nothing.** The list of void
  elements moved into `html.js`, and a test walked `VOID` asserting each one
  emits without a closing tag. Deleting `br` from the set passed: the loop just
  had one fewer thing to check. The tags are written out in the test now and a
  second test says the two lists match, so removing one from either side fails.
  The same shape caught it the first time: before any of this, only `input` and
  `meta` were covered, and only because other tests happened to use them.
- **The compiler leaves `>` in an attribute and escapes it in text.** Both are
  correct, and the difference is why `mergeHead` has to be quote-aware. The
  runtime escapes it in both, so an interpolated value and a static one are
  spelled differently and parse the same. That is deliberate: the runtime ships
  to a browser and must not import from the compiler. `escapeAttr` and
  `escapeText` live in `compiler/html.js`; the runtime's are its own.
- **An action runs after the region is known to exist.** `POST ?fragment=nope`
  used to change data and then 404. Anything that can refuse a request has to
  refuse it before `runAction`, not after. `hasRegion` is that check, in both
  servers.
- **A layout guard is one of the things that can refuse a request, and it did
  not.** The same rule as above, missed for the case that matters most. A layout
  loader returning a `Response` stopped the render, and the render is after the
  action, so a signed-out `POST` reached the handler, mutated, and then met the
  guard on the way out. The response was the guard's redirect either way, so the
  hole was invisible from outside: a test asserting `303 → /login` passed, and so
  did the logs. `runGuards` walks `page.layouts` before `runAction` in both
  servers, throws the data away, and lets `renderRoute` load the chain again, so
  the render sees what the action did rather than what was true before it. That
  is a second run of every layout loader on an action request, on purpose.
  `examples/auth` could not catch this because every page under its guard was
  read-only; it has a `POST` under there now, and the test asserts nothing
  changed rather than asserting the status, which was never wrong.
- **`transclude-env.d.ts` has to compile, and one flag is why nobody saw that it
  did not.** Every context type named `__Cookies` and the file declared it
  nowhere, in every project, from the first `npm run check`. A `.d.ts` is the one
  kind of file `skipLibCheck` skips: `bin/check.js` passed that option to the
  program written to catch exactly this, and a `jsconfig.json` *implies* it,
  along with `allowJs` and `maxNodeModuleJsDepth: 2`, so an editor said nothing
  either. Two skips, one flag, and the guard's own comment says a bad identifier
  must not ship silently. `ambient.js` now holds `__Cookies`, `__CookieOptions`
  and `__Shape` once, as TypeScript text that the shim wraps in JSDoc and the
  emitted file declares. Declaring only what the body mentions has to close over
  what it adds, or `__Cookies` arrives and `__CookieOptions` does not, which is
  the same bug one level down. A type the *app* wrote is a second problem: tsc
  prints a bare name that means something in the file it came from and nothing
  in the emitted one, so `UseFullyQualifiedType` says which file, `InTypeAlias`
  expands it, and the file carries a copy. An import would not work, because a
  `@typedef` written in an `.html` file has no module to be imported from.
- **A project needs no `vite.config.js`, so both bins register the compiler
  themselves.** `dev.js` did not: it passed no plugins at all and took the whole
  compiler from the app's own config file, so an app without one answered every
  page with 500 and `Failed to load url virtual:transclude-page/index` while the
  build carried on working, because `build.js` already passed it. Vite merges the
  two plugin lists rather than deduping, so an app that keeps `transclude(config)`
  in a file of its own registers a second one, and the app's is ordered first and
  wins. That one is built from the raw config rather than from what `loadProject`
  filled in, which held only because the factory carries its own copy of four of
  those defaults. A duplicate is inert now: it would scan the app again and add a
  second dev watcher, and one edit then reloads the browser twice. `api` is the
  only part of a plugin Vite keeps by reference when it copies one, which is how
  an instance knows whether it is the first.
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
- **The public copy skips what an operating system left there.** `.DS_Store` was
  copied into the build and served: `/.DS_Store` answered 200 on the docs site
  and lists every file beside it. Being in `.gitignore` does nothing about this,
  which is the trap: the build reads the directory, not the index. Dotfiles are
  not skipped wholesale, because `.well-known` is a directory people mean to
  publish, so the filter names the three files nobody ever puts there on purpose.
- **`app/public/` is copied to `dist/public`, and Vite's own `publicDir` is off.**
  Left on, Vite serves it in dev ahead of Hono and copies it into both the client
  and SSR outputs, and production served none of it. Dev 200, prod 404. Both
  servers now mount the same Hono `serveStatic`. Only the root differs, and
  production's is under `dist` so the stale-build warning stays true.
- **A public file's validator is its size and mtime, not a hash of it.** These
  went out with `Last-Modified` and nothing else, so a browser guessed how long
  to hold a favicon. Hashing is what the in-memory cache does and is wrong here:
  a video would be read in full to answer a request for its first megabyte.
  Weak on purpose, because a size and a second can collide. `serveStatic` reads
  no request condition, so the 304 is done around it in `public-files.js`, which
  both Node servers now share.
- **A `serveStatic` wrapper has to return what it was given.** A range is
  answered by *returning* a Response rather than by setting `c.res`, so a wrapper
  that awaits and returns nothing leaves the context unfinalized and every Range
  request becomes a 500 saying "Context is not finalized". Nothing in the suite
  caught it: `app.request()` takes a different branch inside `serveStatic` and
  shows no `onFound` headers at all, so the public-file tests run against a real
  listener on a port the OS picks.
- **One table says what a file is, and there were three.** `static-cache.js` had
  thirteen types, `bin/build.js` had eleven, and public files on Node took
  whatever Hono's own table said, which has no `.m4a`, `.wav`, `.mov` or `.vtt`.
  So an audio file in `app/public/` went out as `application/octet-stream`, and
  `nosniff` is on every response, which means the browser was forbidden to look
  at the bytes and find the AAC it would otherwise have played. It did not play
  badly. It did not play. `.mp3` was the worse half of it: `audio/mpeg` on Node
  and `application/octet-stream` on workerd, one app, two deployments, two
  answers. `src/mime.js` is the one answer now, and it imports nothing so the
  build, both servers and anything later can all reach it. Four things hold it
  up. It is a superset of Hono's table, asserted against `hono/utils/mime`,
  because `public-files.js` writes its own type over the one `serveStatic`
  already set and an extension Hono knows and we do not would go backwards.
  `serveStatic` hands `onFound` the `.br` twin it chose, so `page.css.br` is
  typed past that suffix, and only when the `Content-Encoding` it set says a
  twin was chosen: a `backup.tar.gz` nobody compressed is a download and stays
  `application/gzip`. The lookup is `Object.hasOwn`, because the name comes off
  a URL and `/x.constructor` otherwise finds a function on `Object.prototype`
  and sends its source as a content type. And the build prints the kinds of
  public file it has no type for, the way it prints a draft it skipped, since
  the alternative is a file that silently cannot be used. The fix for a wrong
  type is the right type; `nosniff` is not the thing to reconsider.
- **Public files are served by Hono, build output by the in-memory cache.** These
  are different on purpose. Build output is small, used often and never changes, and
  gets a strong ETag for each encoding. Public files belong to the author, can be
  large, and can be media. Media needs byte ranges, and the in-memory path answers
  200 where a 206 was asked for.
- **A release tag is written `--cleanup=verbatim`, or markdown loses its
  headings.** The notes live in the annotated tag and `publish.yml` makes the
  release page out of them, so the tag is the only copy. git's default cleanup
  treats a line beginning with `#` as a comment and drops it, which deletes every
  markdown heading and leaves the paragraphs that were under them. Nothing
  errors, the page is just missing its structure, and a tag is immutable by the
  time anyone reads it. `test/release.test.js` runs the default against real git
  first, so the day that stops being true the flag stops being justified.
- **The `release` job's checkout is not shallow.** `%(contents)` reads the tag
  object, and a shallow checkout of a tag gives the commit without it. The notes
  come back empty and the release page is blank, which looks like the notes were
  never written. `fetch-depth: 0` and `fetch-tags` in `publish.yml` are
  load-bearing, in that job. The other two jobs read files rather than tag
  objects and stay shallow.
- **One job in `publish.yml` holds `id-token: write`, and it installs nothing.**
  That permission mints the identity npm accepts in place of a token, so
  everything running beside it can publish. The tests install the framework, the
  demo and the site, which is hundreds of packages that would each get the same
  reach. So `test` installs and holds no identity, `publish` holds the identity
  and runs `npm stage publish` against a tree it never ran an install into, and
  `release` writes the page with `contents: write`. Merging any two of them back
  together undoes the whole arrangement, and nothing would fail to warn you.
- **`stage publish` stages, and a human publishes.** Both packages deny plain
  `npm publish` at the registry, so a green run does not put a version on npm. It
  waits in Staged Packages until someone approves it with their second factor.
  The release page goes up before that approval, so for as long as it takes to
  press the button GitHub names a version the registry does not serve.
- **A repeated `view-transition-name` is a compile error, because the browser's
  answer is silence.** The name has to be unique in the document, and a browser
  that finds two runs no transition rather than reporting one. `emitAttrs` checks
  it whenever `this.loops` is non-empty, which covers the element carrying `each`
  and everything inside it, because `emitEach` pushes the loop before emitting
  the element. Only the `style` attribute: a name from a class lives in a
  stylesheet this compiler never reads, so the check is the spelling everyone
  writes rather than every spelling there is. `none` is allowed, being the one
  value two elements can share.
- **A rule nothing checks is a rule that drifts, and spelling was the proof.**
  `design/voice.md` asked for American spelling from the day it was written, and
  56 British ones accumulated across 18 files: a comment, the README built from
  it, and the docs page about it disagreed with each other. Nobody was wrong on
  purpose. `test/spelling.test.js` walks what `git ls-files` lists, so it covers
  the examples and the site as well as the package, and needs no app to do it.
  The words are in `scripts/spelling.js` rather than in the test, because
  `.claude/settings.json` runs the same file as a `PostToolUse` hook and two
  copies of one word list is the failure this repository has already had twice.
  Three exclusions, each found by running it rather than by reasoning: a vendored
  `.min.js`, the module `scripts/source-data.js` generates, and the lockfiles,
  where npm records what somebody else called their package. `scripts/spelling.js`
  excludes itself for the same reason the first run after committing it failed.
- **A template file whose name starts with `_` becomes a dot on scaffold.**
  `_gitignore` and `_vscode/` are both spelled that way because a tool that
  finds the real name acts on it: git and npm apply a `.gitignore` wherever they
  see one, and editor tooling reads a `.vscode` as a project. Only the first
  segment is rewritten, so a `_partial.html` inside a directory keeps its name.
- **The editor's built-in HTML validation misreads every element with props and
  state.** The script blocks in one `.html` file are separate modules and it
  reads them as one, so two `export default` blocks become "A module cannot have
  multiple default exports". The file is right. `html.validate.scripts: false`
  is in this repository's `.vscode/settings.json` and is scaffolded into new
  projects, because `transclude-check` and the language server in `editor/` are
  the two things that read these files the way the compiler does.
- **The extension looked for a package that does not exist.** Its server lookup
  said `node_modules/transclude/editor/server.js`, and the package is
  `@transclude/core`, so the server was found only inside this repository,
  through the fallback, and the extension worked for exactly the people who did
  not need it. Nothing errored anywhere: a lookup that finds nothing is an
  extension that quietly does nothing. `test/editor.test.js` pins the path to
  the name in `package.json`, and pins `editor/server.js` into the publish list,
  which is the same failure from the other side. To package it:
  `cd editor/vscode && npm install && npx @vscode/vsce package`. Publishing
  needs a Marketplace publisher whose id matches `publisher` in its
  `package.json`, and `npx ovsx publish` covers Open VSX.
- **`npm run check:src` was red for 476 errors, and nothing ran it.** The script
  existed, the framework type checks its own JSDoc through it, and no job called
  it, so the count only ever went up. Nearly all of them were one shape: a
  parameter documented `@param {object}`, which says opaque rather than a shape,
  so every read of a field on it is an error. It is zero now, and
  `test/typed.test.js` fails on the first one that comes back.

  What fixed it was not an annotation per function. It was a name for each thing
  that gets passed around, written once where the thing lives, and then used.
  `Config` in `src/defaults.js` was the model: `app.js` read fifty-four keys off
  an `{object}`, and that same table is one `VERSIONING.md` calls settled, so the
  type and the promise are one list. The rest followed the same rule.

  | | |
  | --- | --- |
  | `Config` | `src/defaults.js` |
  | `Manifest`, `BuiltRoute`, `PluginManifest`, `ManifestRoute`, `Route`, `Segment` | `src/routes.js` |
  | `Ctx`, `PageModule`, `RenderOptions` | `src/document.js` |
  | `Definition`, `Block`, `Part`, `BlockState`, `KeyedEntry` | `src/runtime/index.js` |
  | `ParsedNode` | `src/compiler/html.js` |
  | `AcornNode`, `ElementModule` | `src/compiler/script.js` |
  | `Fragment`, `Lines` | `src/compiler/codegen.js` |
  | `Blocks`, `HeadBlock` | `src/compiler/index.js` |
  | `Entry`, `ByteStore`, `Store` | `src/static-cache.js` |
  | `CacheStore`, `CacheEntry`, `Window` | `src/cache.js` |
  | `Indexed` | `src/extract.js` |
  | `ProxyConfig`, `Held`, `DocumentStore` | `src/proxy.js` |
  | `FeedConfig`, `FeedItem` | `src/feed.js` |
  | `SitemapConfig` | `src/sitemap.js` |
  | `ElementTypes`, `RouteTypes` | `src/compiler/types.js` |
  | `Chunk` | `src/compiler/shim.js` |
  | `Encoded` | `src/worker.js` |

  Two are permissive on purpose. `ParsedNode` and `AcornNode` have one required
  field and everything else optional, because both walks read across a
  discriminated union and have already established which kind they hold. Naming
  the real union would mean narrowing at every read, in trees these files know
  the shape of.

  `ManifestRoute` and `BuiltRoute` look like one thing twice, and the reason is
  `client`. In the plugin's manifest it is what the route needs: its tags, and
  whether it has a script. In `dist/routes.json` it is the hashed URL the build
  wrote. Same field, two answers, because each manifest answers the question its
  own reader asks.

  Write a type from the call site, not from memory. The first `Config` said
  `onError` takes one argument and the code passes two, and the checker caught
  the annotation rather than the call. Several `@returns` were simply wrong:
  `absoluteFrom` was documented as returning a `URL` and returns a function,
  `windowOf` as returning a number and returns an object or null, `assertModule`
  as returning void and returns a string. Each was a sentence written from
  memory about code somebody had just finished.
- **`return` and a block comment holding a newline is `return;`.** Writing
  `return /** @type {…} */ (value);` with the cast wrapped across two lines puts
  a line terminator between `return` and its operand, ASI closes the statement,
  and `refuseMovedAPI` came back `undefined`. The checker then failed to
  destructure its own module at import, on the next line. Keep a cast on one
  line, or name the value first and return the name.
- **A refusal knew where it was and could not say.** Every `CompileError` is
  raised with a parse5 node, so every one has a line and a column. Only the line
  was read, and it was appended to the message as `(line 84)`. That tells a
  reader which row to open; it does not tell them which of the four elements on
  it. `CompileError` carries `column` now, `frameOf` in `codegen.js` draws the
  two lines either side with a caret, and `src/plugin.js` attaches `loc` and
  `frame` to anything it catches — the shape Vite already renders, in the
  overlay and in the terminal, so no reporter had to be written.
  Attached in the plugin rather than in the error, because the compiler is
  handed a source and never a path: the file name lives where the read happened.
- **The promise nothing pinned was the API itself.** The docs said the config
  keys and the loader context are settled and that tests pin both to the code,
  and both were true. The `exports` map was neither: a subpath could be renamed
  in a manifest edit and nothing would read it as the major it is.
  `test/package.test.js` holds the list now, and it fails in both directions —
  a name gone is a major, a name added is a minor to acknowledge.
  `VERSIONING.md` is the policy, and it is the only copy: the site's decisions
  page links to it rather than restating it, because a promise kept in two
  places gets made twice and differently. A test checks that the tests it names
  still exist, since a policy naming a guarantee nothing keeps is worse than one
  that claims nothing.
- **The type printer is a dependency, and now there is a canary for it.**
  `src/typecheck.js` drives `typescript/unstable/sync` and says in its own
  comments what it cannot defend against: a flag that is renamed ORs into
  TYPE_FORMAT as `undefined`, and types print differently with nothing failing.
  `refuseMovedAPI` catches a gone subpath or a missing enum, which is the loud
  half. `test/typecheck.test.js` now pins the exact strings the printer returns
  for a fixed element: an alias printed by name rather than expanded, and the
  definition `describe` collects for it. If TypeScript renders a type
  differently the test says so, instead of the difference reaching
  `transclude-env.d.ts` and reading as the author's mistake.
- **A guard that exits first hides everything behind it.** `bin/check.js` writes
  `transclude-env.d.ts`, hands it to `checkAlone`, and exits on a bad
  identifier before it checks a single page. That guard is right: nothing
  downstream reads that file, so a bad name would otherwise ship in silence.
  What it also does is stop the run, and the showcase sat behind it for a day.
  A migration dropped two `@typedef` blocks out of `card-list.html`, so `Person`
  resolved to nothing, so the guard fired, so the twenty-two pages after it were
  never checked. Four unrelated errors in `tag-picker.html` were sitting there
  the whole time. Nothing noticed, because no job ran an example's `check` —
  `ci.yml` built them and ran their tests, and that was all. It runs their
  checks now.
  Read the failure as "the run stopped here", not as "this is the error". The
  first thing to do with a `checkAlone` refusal is fix the name and run it
  again, because what comes back the second time is the real list.
- **The first thing `typescript-next` reported was not about TypeScript.** It
  went red on `7.1.0-dev`, and the reading that suggests itself is that the
  printer moved: the checker drives `typescript/unstable/sync`, `refuseMovedAPI`
  cannot see a printer that spells a type differently, and the failure was a
  type name the generated file could not resolve. Every part of that is true and
  it was still the wrong answer. The same failure reproduced on 7.0.2, and on
  v0.19.0 and v0.18.1 before that. It was the dropped `@typedef` above, and the
  job was the first thing that had ever run that check.
  Establish the baseline before believing a new tool's first finding. Running it
  on the pinned version costs one command, and it is the difference between
  "the new thing broke it" and "the new thing found it".
- **`npm test` reports `src/runtime/index.js` at 43%, and the number is an
  artifact.** `withDom` in `test/element.test.js` imports the runtime as
  `../src/runtime/index.js?${random}`, so nothing leaks between cases. Node's
  coverage does not attribute a query-string import back to the file, and the
  element tests do drive the real element class. Read the 43% as "not measured
  here", never as "not covered". Anyone tempted to raise it should check what a
  test imports before writing one.
- **Sixty-one passing checks were the whole of what anybody knew.** What a fake
  DOM cannot answer is the part that needs a real one: `attachShadow`,
  `setHTMLUnsafe`, a declarative shadow root the parser built. The checks in the
  showcase cover that, and they answer whether they pass, not how much they
  reach. Nobody could say, which is why the shadow half sat in "still moving"
  for as long as it did. `examples/showcase/scripts/coverage.js` asks V8
  directly, through the DevTools protocol: 98.5% over 63 checks.
  Measuring it is what found the gap. Every shadow check started from markup the
  server had sent, so `connectedCallback` always adopted a root the parser built
  and the first render was a bind over nodes that already existed. The other
  branch — `attachShadow` and a paint with nothing to bind to — is what
  `document.createElement` takes, and it had no check at all. Two now. Note the
  shape of the failure: not a wrong answer, but a question nobody had asked,
  behind two numbers that both looked like answers and were not.
  The `browser` job runs the measurement with `--floor 95`, because a number the
  documentation prints is a number something has to keep true. Without it the
  checks would go on passing while the coverage rotted, and the claim would go
  on being made: the same shape as the four-runtime claim below.
- **The four-runtime claim ran on one runtime.** The README opens by promising
  Node, Bun, Deno and workerd. CI ran Node 22, and only Node 22:
  `test/portable.test.js` proves the core imports nothing from `node:`, which is
  the shape of portability and not the fact of it, and workerd was exercised
  only by deploying the site, which reports success for a page nobody asked for.
  All four worked when `scripts/smoke.sh` was written, which is the point rather
  than the relief: the claim was true and unwatched, so the day one of them
  broke it would have kept its line in the README and nothing would have failed.
  TodoMVC is the app it serves, because it renders a compiled page and has
  nothing but forms, so one GET and one POST cover both paths through the app.
- **A dotfile made the build look stale.** `newestSource` in
  `src/production.js` walked every file under the app and the framework and took
  the newest. Finder writes `.DS_Store` whenever somebody opens a directory, so
  on macOS the newest file was usually that, and starting the server printed
  "changed 13926s after the last build. Run `npm run build`" for an edit nobody
  made. Nothing was wrong and nothing was broken, which is worse than either: a
  warning that is usually wrong gets read as decoration, and the one time it is
  right is the time it needed to be read. Dotfiles are skipped now.
- **The package shipped no type declarations.** `exports` mapped every subpath
  straight at a `.js` file, so a TypeScript project importing
  `@transclude/core/app` got TS2307 and `any`, from a framework whose fourth
  selling point is types without writing TypeScript. The JSDoc was already
  there; nothing emitted it. `tsconfig.types.json` writes `types/api`, and
  `test/package.test.js` pins the mapping, because a subpath added to `exports`
  with no `types` condition fails nowhere: it types as `any` and the build stays
  green. `types` is listed above `default` for the same reason conditions have
  an order.
- **Nothing builds at publish time, so a generated file has to be committed.**
  The declarations above were written to `dist/types` and generated by a
  `prepack`, which is how a package normally does this and is wrong here.
  `publish.yml` stages the tarball with `npm stage publish --ignore-scripts`
  and runs no `npm ci` in that job, both on purpose: it holds the only identity
  that can release, and installing hundreds of packages into it is what the
  three-job split exists to prevent. So `prepack` would have run nowhere, `tsc`
  would not have been installed to run, and every `types` condition would have
  named a file the tarball did not carry. Types that resolve to nothing are
  worse than no types: a missing file is an error, and an absent condition is a
  fallback. Nothing here would have failed either — `npm test` passed, the pack
  on a developer's machine was correct, and only a real publish differed. The
  output is committed, and the test regenerates it into a temporary directory
  and compares, because a committed generated file drifts the first time
  somebody edits one and not the other. Pack the way that job does before
  trusting a tarball: `npm pack --ignore-scripts`.
- **`typescript` was a required peer for a command most projects never run.**
  It is imported by `src/typecheck.js` and nothing else, which is
  `transclude-check`. Every install pulled it anyway. It is optional now, and
  `bin/check.js` loads the checker dynamically to say so: a static import is
  hoisted above any guard, so the missing package would have spoken for itself
  in `ERR_MODULE_NOT_FOUND`, naming a dependency the author never chose.
- **A documented snippet named a package that does not exist.**
  `docs/testing.html` imported `transclude/production`; the package is
  `@transclude/core`. The same mistake the VS Code extension had already made
  from the other side, one gotcha up, and both were silent for the same reason:
  a specifier in prose is not run, and the reader who runs it gets a resolution
  error naming a package they never wrote. `test/specifiers.test.js` reads every
  `from`, `import()` and `require()` in every tracked file and checks the name
  and the subpath against the two manifests. Only a real call counts, so prose
  can name a wrong specifier, which is what lets the gotcha above quote one. It
  cannot write one out as a call, though: this paragraph said
  `import(…)` around the bad name and the test failed on its own
  documentation, which is the check working.
- **A directory in `files` publishes what git ignores.** `files` said `editor`,
  to ship the one file the extension starts. It shipped the directory: an
  installed `editor/vscode/node_modules` and a built `.vsix`, 324 files and
  2.2 MB, 77% of the package, into the `node_modules` of everyone who installed
  the framework. Both are untracked, and untracked is not the same as unpacked:
  `.gitignore` keeps a file out of the repository, and npm reads it only where
  no `files` list overrides it. A releaser who had run `vsce package` published
  a different tarball than one who had not, and nothing said so. Name the file,
  not the directory holding it, whenever a directory is also somewhere work
  happens. `npm pack --dry-run` is the check, and it is the only one that
  answers this question: the publish list is not what `git status` shows.
- **A directive rule that matches the name alone leaves the value to the HTML
  grammar, which has moved past it.** `each` was highlighted by one pattern
  matching the word. HTML's own attribute rule had already passed the position
  where an attribute may start, so the `=` came out
  `invalid.illegal.character-not-allowed-here`, `of` and `inks` came out as two
  more attribute names, and a `>` inside the value ended the tag and dropped the
  rest of the line on the floor. 263 error tokens across the committed `.html`
  files, and `if="hop.count > 1"` in four of them. It reads as a string colored
  red rather than as a mistake, which is why it stood. A directive that takes a
  value is a `begin`/`end` block now, opening on the quote and closing on it, and
  the value is `source.js`: `each` names its item and its index, `of` is an
  operator, and everything after it is an expression, which is what the compiler
  does with it.
- **A directive is only a directive inside a tag.** `else`, `if` and `each` are
  ordinary English words, and `injectionSelector: "L:text.html -comment"` reaches
  the whole document, so "nothing else matters" had a keyword in the middle of it.
  The directives live in `transclude.directives.json` under
  `L:text.html meta.tag` for this, and `transclude.injection.json` keeps the
  whole-document selector, which `${…}` and a `<script server>` block both need.
  Two files because a grammar has one selector.
- **The sprite is written after the public copy and before anything that reads
  `dist/public`.** The asset module a worker imports, the precache list and
  precompression each build themselves by walking that directory. Written earlier
  and the public copy overwrites it; written later and all three miss it, so Node
  serves `/icons.svg` off disk and a worker 404s it with nothing to say why.
- **Internals are attached for a boolean state field, not for any state.** A
  custom state is a name, so a number or a string has nothing to reflect.
  Attaching for every stateful element gave `user-card` internals it never uses
  and broke the check asserting an ordinary element has none, which is how the
  narrow rule was found rather than reasoned to.
- **A custom state lands with the render, not with the assignment.** It is
  reflected from the one place both element classes work out current state, so
  the state and the markup it styles change in the same frame. A check asserting
  it synchronously after a setter fails, and it should: `updateComplete` is the
  point at which either is true.
- **A prerender runs the page; a prefetch does not.** That is the whole split in
  `speculate.js`. A URL the build wrote to a file has no loader left, so the
  browser may run it. Everything in `dynamic` is a server render whose loader may
  read a cookie or count a view, so it is prefetch only. Put a dynamic route in
  the prerender list and a reader who merely hovered a link has visited it.
- **The rules are computed before the render pass and carried in the manifest.**
  Every page embeds the block, so it cannot be computed from what the render pass
  produced, and `targets` already says which URLs will be files. Carried in
  `routes.json` because the server renders the dynamic routes and has to send
  what the files send. Computing it twice is two answers about what a browser may
  run, and only one of them was ever checked.
- **The speculation block is hashed by the CSP that already exists.**
  `inlineSources` matches every `<script>`, so nothing was added for this and
  nothing should be: a policy built from what the page inlines covers a block the
  page inlines. Verified in Chrome with `csp: true`, no violation reported.
- **A library is a directory, so the URLs the sprite claims are not a fixed
  list.** `app/icons/lucide/` is `/lucide.svg`, which is the point: a downloaded
  icon set is put here whole and nothing is renamed. `refuseSpriteClash` takes
  the libraries rather than one name, and dev answers `/:file{[^/]+\.svg}`
  because it has no list until it reads the disk. That route is registered after
  `baseApp`, so the author's own `public/favicon.svg` is answered by the public
  handler first and never reaches it. Register it earlier and every public SVG
  becomes an icon-sheet lookup. `check.html` holds that ordering.
- **A directory inside a library is refused, not flattened or skipped.**
  Flattening gave `lucide/arrows/up.svg` and `lucide/up.svg` one id, which is the
  collision the flat reading used to stop the build over. Skipping loses icons
  and says nothing. One level, and the message names the path.
- **One thing answers for `/icons.svg`, and the two servers pick opposite
  winners.** The build copies `app/public/` and then writes the sprite over it;
  dev asks the public handler first and never reaches the sprite. Same two files,
  different answer per server. `refuseSpriteClash` stops both rather than picking,
  which is why it is called in `bin/build.js` and again in `bin/dev.js`.
- **parse5 closes an SVG element by namespace, not by tag name.** The sprite is
  served as `image/svg+xml`, so a browser parses it as XML, where nothing is void
  and every tag closes. `<image>` or `<use>` serialized the HTML way would take
  the whole document down and every icon with it, not just the one. `test/icons.test.js`
  holds that claim, because it is one parse5 version away from changing.
- **An icon with no `viewBox` is refused, not warned.** A symbol scales by its
  viewBox. Without one the icon renders at some other size, which reads as a CSS
  problem and is not one. Same for two files claiming one id: the second would
  quietly never be reachable, so the build stops and names both.
- **Dev builds the sprite per request; the build writes it once.** Both call
  `readIcons` then `buildSprite`, and that is the point. Two copies of those two
  lines is how `/icons.svg` comes to work in production and 404 in dev, which is
  the same failure `include.js` was written to end.
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
- **A prerendered page hides what its loader needs.** The www site highlights its
  code samples with shiki, which at the time compiled WebAssembly, and workerd
  refuses that at runtime. Every page still answered, because a prerendered page
  is bytes and never runs its loader in production. The one URL that renders
  live, `/?fragment=demo`, returned 500. So "it works on workerd" is a claim
  about the routes that render there, not about the build. Two fixes hold: the
  landing page's loader returns early when `ctx.fragment` is set, and shiki now
  runs on its JavaScript regex engine, so nothing compiles Wasm at all.
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
- **`Secure` follows the connection, and `X-Forwarded-Proto` is trusted only to
  turn it on.** A cookie had `Path`, `HttpOnly` and `SameSite=Lax` and no
  `Secure`, so a session could go over plain HTTP. Always on breaks
  `http://localhost`, and an author who cannot keep a session in dev turns the
  whole thing off, so it follows the request. Behind a proxy that terminates TLS
  the request's own URL says `http:`, and the forwarded header is what closes
  that. Believing a client-set header is safe in exactly one direction: a lie
  turns `Secure` *on* and the cookie is then withheld over plain HTTP, which
  fails closed. Nothing reads it to turn `Secure` off.
- **`nosniff` is sent always; `X-Frame-Options` and HSTS are not.** Nothing
  legitimate depends on a browser second-guessing a declared Content-Type, so
  that header has no judgment in it and is on for every response including a
  404 and a public file. The other two refuse something an app may actually
  want, one being embedded and one being reachable over HTTP at all, so they
  stay the author's to set.
- **Most of what `check:src` reported was the JSDoc being wrong, not the code
  being untypeable.** It was called noise from parse5 node shapes and it was not:
  of 180 diagnostics, 115 were annotations that disagreed with the thing they
  described, nearly all written in one pass from memory rather than read off the
  code. `scanRoutes` was documented as returning an array and returns four named
  lists. `checkUrl` was documented as returning an object and returns a string or
  null. `createApp`'s parameter never listed `endpoints`. The gate in
  `test/source-types.test.js` includes TS2353, TS2741, TS2739 and TS2740, which
  are that class in both directions, so it cannot come back.
- **A source map is handed back from `load`, not written into the code.** Vite
  composes a map a plugin returns and does not read a `//# sourceMappingURL`
  comment on the code it was given, so the inline version changed nothing and a
  dev stack still named `virtual:transclude-page/x` and a generated line. With
  the map returned, it names the `.html` and the line of markup.
  `compiler/sourcemap.js` writes the v3 encoding: line level, because a
  generated line is one statement from one expression and a column would claim
  precision the codegen does not have. The blocks are found by a marker the
  assembler writes above each one, resolved **in the order they appear** rather
  than the order the caller listed them: removing a marker shifts every line
  already noted below it, silently, one per marker, and the first test passed
  only because it listed them in file order.
- **The `\0` prefix was what kept the production bundle from mapping.** The
  suspicion in an earlier version of this entry, confirmed on Vite 8.2.1:
  rolldown leaves `\0`-prefixed ids out of the map it composes, so
  `dist/server/entry.js.map` listed no `.html` at all while the `load` hook
  returned a valid map for every page. The ids now carry no prefix,
  `sourcemap: true` is on for the SSR build, and every page and layout is a
  source, loader lines included. Three traps around it are load-bearing. The
  `// @ts-nocheck` banner is prepended after the bundle is written, so the
  build shifts the map one line to match, or every position is off by one. A
  failure's stack is resolved by `src/stack.js`, exactly, not by Node: Node's
  consumer takes the nearest earlier mapping when a position has none, and in
  a bundle that can be another file, which is how a throw in `colophon.html`
  was once reported as `app/lib/code.js:81` with full confidence. And the dev
  URL is the prefix's other half: `clientEntryUrl` said `__x00__`, Vite's
  spelling of `\0`, and with unprefixed ids that URL was a 404 on every page
  that ships JS, in dev only. The map costs `dist/server` an `entry.js.map`
  about the size of `entry.js`; nothing serves it.
- **A preload hint is set on the way out, never on `ctx.response`.** A header on
  that object is one of the things that makes a page too personal to cache, so
  writing the `Link` there would turn every page in the app into a miss.
  `sendRendered` sets it on the response instead, after `cacheable` has been
  decided. A test renders twice and counts, and the mutation that catches it is
  writing the header inside the render closure rather than at send time: doing it
  later in `sendRendered` is already too late to break anything, so that
  mutation proves nothing.
- **A page does not stream, and the synchronous render is why.** An endpoint
  does: it returns a `Response` the app never touches the body of, so a
  `ReadableStream` reaches the client through `runEndpoint` and `withEnvelope`,
  and Node flushes it as it is written. Measured against a live server, with a
  header set on `ctx.response` so the envelope had to rebuild the `Response`,
  which is the step that could have dropped the body. `examples/live` is that.
  For a page it is still true, and every render
  function is `__o += …` to the last component, which is what lets an external
  include resolve before the render and a prerendered page stay a file. Async
  render would tax every component call for something most pages here do not
  need. The mitigation that is portable is a `Link: rel=preload` header for the
  stylesheet and the client entry, which come from the route table rather than
  from a loader and so are known before any loader runs. A proxy that reads it
  sends a 103. 103 cannot be sent from here directly: a `Response` carries one
  status, and the Fetch API does not model an informational one.
- **The precache list is a build artifact, and cannot be anything else.** Only
  the build knows an asset's hashed name, and a runtime with no disk cannot be
  asked: `bytesFrom` in `worker.js` returns `{ get }` and nothing that
  enumerates. So `bin/build.js` writes `dist/static/precache.json` before the
  asset module and before compression, the module carries it for workerd, and
  `production.js` reads it back. `revision: null` means the URL is the version,
  which is true of a hashed asset and false of everything else, so
  `precacheList` throws on a page with no ETag rather than emitting null and
  having a service worker hold it forever. The revision is a build-time hash and
  is not compared against a served ETag: public files go out through Hono's
  `serveStatic`, which sends none.
- **The framework's own `<meta>` defaults go through the merge too.** The shell
  wrote `viewport` and so did anything that wanted its own, and both shipped.
  The default is now the outermost level handed to `mergeHead`, so a page or a
  layout replaces it, and it is emitted back in its old position above `<title>`
  rather than wherever the merged list puts it. `charset` stays hardcoded: it has
  to be inside the first 1024 bytes and is not something to override. Found by
  generating a project with the new CLI and reading the output, which is the
  first time anything here rendered a page that writes its own viewport.
  `frameworkHead` is that level, and `canonical: true` puts its `<link>` there
  for the same reason. Anything else the shell ever writes belongs in that
  function rather than in the template below it.
- **A config key lives in two lists, and only one of them is checked against.**
  `withDefaults` refuses a key it does not know, and `KEYS` is what it knows:
  `DEFAULTS` plus `UNDEFAULTED`. A key with a default needs no second entry,
  because `KEYS` derives from `DEFAULTS`. A key with no default — `feed`, `cache`,
  `port`, anything whose absence has to mean something other than a value — is
  real only because `UNDEFAULTED` names it. Add one and forget that list and the
  key is refused as a typo, which is the same failure as never adding it, worn as
  an error message. The site's own suite compares the documented table against
  `KEYS`, so a key added to neither list and no page fails there too. The check
  itself replaced a silent loss: `stylesheeet` for `stylesheet` took a site's
  whole stylesheet away and said nothing, and the config page claimed this throw
  for months before anything did it. `settings` in `src/proxy.js` refuses the
  proxy's own keys the same way, its `KEYS` being `DEFAULTS` plus `lookup`. Its
  first run caught `fetch: undefined` in this repository's own test suite, a
  key nothing had ever read.
- **`canonical: true` is refused in `withDefaults`, not at the render.** Four
  places render a page: two in `app.js`, one in `bin/dev.js`, one in
  `bin/build.js`. Only the first three hold a request whose origin `absolute()`
  could fall back to, so a canonical URL built without `metadataBase` would be a
  localhost URL in dev and a thrown error in the build. `withDefaults` runs on
  every path into the framework, which is what makes it the one place that can
  refuse both halves the same way. The URL itself is built in `renderRoute`, from
  `ctx.route.path`, so the four callers pass a flag rather than each computing
  one. Under `trailingSlash: 'ignore'` that path already has its trailing slash
  stripped by Hono's loose router, so the tag names the one form without asking.
- **Two packages, and `@transclude/create` depends on neither.** Scaffolding six
  files should not download a compiler, so the CLI carries its own copy of the
  templates and names `@transclude/core` in what it writes rather than importing
  it. `npm create @transclude` resolves to `@transclude/create`, which is npm's
  own rule: `npm init <@scope>` is `npx <@scope>/create`. The unscoped
  `transclude` on the registry is somebody else's, published in 2017 and
  untouched since, and is not worth a dispute.
- **`create/templates/` is what a new project is, and `_gitignore` is why.** A real
  `.gitignore` inside a template is applied to the template itself by everything
  that reads one, npm included when the package is packed, so the file is stored
  under a name nothing recognizes and renamed on the way out. The tests assert
  the files rather than the copying: neither template ships a fragment, an
  include or an element, because those are decisions a project makes and the
  showcase already demonstrates.
- **`<head>` merges across the chain, `<meta>` and canonical by key.** The chain
  was concatenated, so a root layout with a default `og:image` and a page with
  its own shipped both, and two of those is not an override: a crawler reads two
  images and takes the first, which is the outermost, which is backwards. Same
  rule as `renderHtmlAttrs`, which `<head>` never got. `name`, `property` and
  `http-equiv` are separate keys, and among links only `rel="canonical"` is
  unique, because a page has several `alternate`s and several `preload`s on
  purpose. Across levels only: two `og:image` written at one level are meant.
  The scan is quote-aware because `escapeAttr` escapes `& " <` and *not* `>`, so
  `content="a > b"` is legal and stopping at the first `>` cuts the tag inside
  its value and leaves the tail in the document. The test for that was vacuous
  at first: it searched for the whole value, which a truncated cut does not
  leave behind either. It counts the surviving tags now.
- **A hoisted tag's directive has to be decided before anything is emitted.**
  `<title>`, `<meta>`, `<link>` and `<base>` at the top level of a page are
  written into the head buffer, and `emitElement` used to be where that was
  decided. That is too late for `if`: `emitBranches` has already written
  `if (…) {` into the body buffer, so the condition guarded an empty block and
  the tag went into `<head>` on every request. `<link rel="next" if="older">`
  shipped to everyone. Nothing failed, and the attribute was stripped as a
  directive on the way, so the source did not show it either. `hoistTargetOf`
  picks the buffer in `emitChildren`, before the chain is emitted, and
  `anchored()` is off inside `<head>` because nothing there is ever re-rendered
  and the block anchors would be comments nobody looks for. A chain mixing a
  hoisted tag with an ordinary one has no single buffer, so it is refused, and so
  is a directive on `<title>`: which level's title wins is settled at compile
  time from `hasTitle`, and a false condition would leave the document untitled
  with the layout's title already ruled out.
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
  honors the cookie and half serves a file, and both look fine on their own.
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
  accident. `src/rewrite.js` asks the other question and gets the other answer,
  so the two files keep their own `kidsOf`.
- **The cleaning descends into a template, because a declarative shadow root is
  not inert.** `src/rewrite.js` read `childNodes` too, and there it was a hole
  rather than a decision: nothing inside a `<template>` was visited, so a script,
  an `on*` handler and a `javascript:` URL all traveled untouched. Inert content
  would make that harmless, and `<template shadowrootmode="open">` is not inert.
  It becomes a real shadow tree in the page that includes it and a `<script>` in
  there runs, on the including page's origin. So `kidsOf` in that file reads
  `.content` when a node has one, and asks for the field rather than the tag
  name: `<template>` inside `<svg>` is an ordinary foreign element whose children
  are on `childNodes`, and a check for the name walks past them. `baseOf` keeps
  `ownKidsOf`, which does not descend, and takes a `<base>` only in the HTML
  namespace. Both are the same rule: honor a base the browser would have honored.
  Template content is inert and `<base>` inside `<svg>` is an SVG element of that
  name, so either one would point every relative URL in the document at a host
  the source never used.
- **SVG animation is stripped, because it writes an attribute after the check has
  read it.** `<animate attributeName="href" to="javascript:alert(1)">` inside an
  `<a>` leaves an anchor navigating to a value the scheme check never saw, and
  `<set>` does the same with no animation at all. `to` is not the only carrier:
  `from` holds one, and `values` is a semicolon list where the URL can be any
  item, so a scheme check there has to split the list and know which attribute
  names hold a URL. Refusing `animate`, `set`, `animateMotion` and
  `animateTransform` is the smaller rule. It costs animation in foreign SVG,
  which is less than this sanitizer already spends on `<style>`.
- **`${}` in a `<script>` or a `<style>` is a compile error, and `json()` is the
  one way through.** Text in those two is raw text: escaping it would change what
  the browser reads, since `&amp;` is an ampersand in prose and four characters
  in JavaScript. So `emitText` emitted `__str`, which does not escape, and
  `<div><script>var a = "${x}"</script></div>` wrote a value straight into code.
  A top-level `<script>` in a page is read as a block and never hit this; a
  nested one is markup and did. No escape fixes it either: a value closing the
  string it was written into runs whatever follows, which is a fact about
  JavaScript rather than about markup. `json()` answers the narrower question,
  JSON with `< > &` and U+2028/9 as `\uXXXX`, and `assertRawTextSafe` allows it
  only as the entire text of the script. It is in `GLOBALS` so it resolves to the
  runtime rather than to a field of the page's data. For a style there is no
  carve-out: read the value through a custom property, which is an attribute and
  is escaped. Write U+2028 and U+2029 as escapes in source, never as literals; a
  raw one inside a regex literal is a line terminator and the file will not
  parse, which happened twice writing this.
- **A region name is attacker input, so look it up with `Object.hasOwn`.**
  `page.regions?.[region]` answered for everything on `Object.prototype`:
  `?fragment=constructor` found `Object`, truthy and callable, so the region was
  "found". `hasRegion` is the check an action runs behind, so that name ran the
  action and then replied with whatever `Object(data)` stringifies to instead of
  the 404 the guard exists to send. `__proto__` gave a 500 instead. `regionOf` is
  the one lookup now, own properties only and the value has to be a function.
- **A literal `${` is written `\${`, and the comment above the scanner said for a
  long time that it could not be written at all.** The escape is in
  `splitInterpolations` and has been. A bare `${` is read as an interpolation, so
  `${}` in prose still fails with `bad expression "": empty expression` and a line
  number in the compiled file rather than the source. Passing examples in from the
  loader also works and is what most of `www/` does, because a JS string can hold
  them without either escape.
- **The escape was applied to text and not to attributes.** `emitAttrs` took the
  static branch and wrote `attr.value` rather than the parts
  `splitInterpolations` had already unescaped, so `title="\${name}"` in the
  source put a backslash in the page. Text was right the whole time, which is why
  nobody saw it. If you touch either path, `test/markdown.test.js` asserts both.
- **Markdown is converted in exactly two readers, and they must not disagree.**
  `plugin.js`'s `read` compiles the page; `typecheck.js`'s `sourceOf` reads the
  same page to collect its names. Both go through `sourceOf` in `src/markdown.js`.
  A third reader that calls `fs.readFileSync` directly type-checks Markdown as
  HTML, which parses, produces no names, and reports nothing.
- **A diagnostic in a `.md` page is an offset into the converted HTML.**
  `bin/check.js` asks `checker.sourceFor(file)` rather than reading disk. Reading
  disk put the caret under an unrelated word several lines from the mistake, and
  looked authoritative doing it. A real position needs a source map from the
  conversion, and the conversion belongs to the app.
- **A closing script tag inside a `<script server>` block ends it in Markdown
  too.** This is the ordinary HTML parser rule, and it bites harder here: the
  rest of the loader renders as prose and the page still builds. `examples/markdown`
  hit it on the first run, in a comment.
- **Three places decide what a page file is.** `PAGE_EXTS` in `routes.js`, the
  watcher in `plugin.js`, and the watcher in `bin/dev.js`. The dev server is a
  separate program and this is the fifth thing that has to change in two places.
- **The build cannot see a gate in `app/server.js`, and the failure looks like a
  success.** Middleware never runs during a build, so a page behind a payment or
  auth check is rendered, written to `dist/static`, counted in "4 pages
  prerendered" and then served by any static host. A layout guard is caught
  because the build runs layout loaders and a guard reads a cookie. Nothing runs
  `app/server.js`. `export const gated` is the declaration, `src/gate.js` is the
  matcher, and every mistake here fails open, so both mistakes are refused:
  `readGated` takes anything that is not a list of paths, and the build takes an
  entry that covers no route, no URL a `paths()` names, and no public file.
- **`gated` reaches the runtime through `routes.json`, not through a second
  config key.** `sitemapEntries` reads `manifest.gated`, which is how the written
  sitemap and the `/sitemap.xml` route leave out the same URLs. Two lists would
  be two answers about what a crawler is invited to.
- **`src/gate.js` has no imports on purpose.** The sitemap reads it at runtime on
  every runtime, so it must not drag `prerender.js` and its context builder into
  a worker bundle. `test/portable.test.js` names every module the core reaches,
  so adding one there is a decision rather than a side effect.
- **Nothing installs Vite or TypeScript for you.** Both are optional peers, and
  npm skips an optional peer rather than installing it alongside the package. It
  also brings no peer at all for `file:..`, which is how the apps here depend on
  the package. So every app in this repository lists Vite and TypeScript in its
  own `devDependencies`, and so does what `create/templates/*` scaffolds. Those
  entries look redundant and are load-bearing. Measured both ways when Vite was
  still required: from a tarball it landed, from a path it did not.
- **Only `src/vite.js` may import `vite`.** It is an optional peer because
  `bin/build.js` and `bin/dev.js` are the only two things that load it and
  nothing on the serve path does, so a container running a built app should not
  carry a bundler it will never call. A static `import … from 'vite'` anywhere
  else puts it back and says nothing: the module graph resolves at load, so the
  first symptom is a server that will not start, with a resolver error naming a
  file inside this package. `loadVite()` is a dynamic import behind a message
  that says what to install, and `test/vite.test.js` runs a copy of the module
  where vite cannot resolve, because that is the only way to see what the
  author sees.

## Testing

The rule the tests are built on: **after `bind` and `update`, the DOM must
serialize to exactly what a full render of those props produces.** One assertion
catches index errors, bad splits, escaping drift and missed attributes.
`test/dom.js` is a parse5-backed DOM to run it in Node.

Falsify before trusting. Break a mechanism on purpose and confirm only its own
tests fail. Several gaps in coverage were found exactly this way.
