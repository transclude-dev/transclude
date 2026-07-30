# transclude

HTML is the product. A page is an `.html` file, the server renders it, and what
arrives is markup a browser already knows how to display. Nothing has to run for
the page to be correct.

One `.html` file is the unit of authorship, and the directory tree is the route
table. A page answers GET. Its `actions` answer POST and the other verbs, so a
plain `<form method="post">` works. A `.js` file in the same tree is an endpoint
that returns a `Response`. The server side is built on Hono.

Any element in a page can be given an id and asked for on its own URL. That is
the hypermedia part: a region of a page is a resource, so a client can ask for
one piece and swap it in, and the same markup renders inline for a full page
load. The framework ships nothing that does the swapping. htmx, Turbo or a short
`fetch` drives it.

Reuse comes in two kinds, and the plain one is the default. A **partial** is
markup pulled into its caller: no boundary, page CSS reaches it, `<label for>`
works, and it ships no JavaScript. A **component** gets a shadow root, a real
`<slot>` and re-renders when its attributes change. Components matter, and they
are what makes an element that survives being moved around a live page, but they
are the answer to a narrower question than most pages ask.

The same app runs on Node, Bun, Deno and workerd. A page ships no client
JavaScript unless it uses a component, and the browser downloads no runtime
dependencies.

```
npm install
npm test           # 515 tests, and they need no app
npm run test:demos # the demo's own tests, against a build
npm run demo       # the demo on http://localhost:5173
```

`demos/everything` is an app built against this package, the same way any other
project would be. It is where the browser checks live, because those need an app
to run against, and it is what the four runtimes are checked with.

## What a page looks like

```html
<script server>
  import { notes } from '../data/notes.js';

  // Answers GET. Whatever it returns is what the template reads.
  export default async () => ({ notes: notes.all() });

  // Answers everything else. A <form method="post"> reaches this.
  export const actions = {
    async post({ request, url }) {
      notes.add((await request.formData()).get('text'));
      // 303, so a reload is a GET and does not submit again.
      return Response.redirect(new URL(url).origin + '/notes', 303);
    },
  };
</script>

<title>Notes</title>

<form method="post">
  <input name="text" required />
  <button>Add</button>
</form>

<!-- An id plus `fragment` makes this a resource: /notes?fragment=list -->
<ul id="list" fragment>
  <li each="note of notes">${note.text}</li>
</ul>
```

That page works with JavaScript turned off. It also answers
`GET /notes?fragment=list` with just the `<ul>`, from the same compiled markup,
so a swap cannot drift from the page it replaces part of.

## Using it in an app

An app is a directory with a `transclude.config.js` in it. That file is the whole
interface: every path the framework needs is named there, and nothing in the
package names a path of its own.

```jsonc
// package.json
{
  "dependencies": { "transclude": "^0.1.0" },
  "scripts": {
    "dev": "transclude-dev",       // Hono + Vite, http://localhost:5173
    "build": "transclude-build",   // -> dist/
    "start": "transclude-serve",   // serves dist/
    "check": "transclude-check"    // tsc over every .html and .js route
  }
}
```

Bun and Deno run the same built app through their own adapters, which are files
rather than bins because a bin's shebang would run them under node:

```
bun node_modules/transclude/bin/serve.bun.js
deno run -A node_modules/transclude/bin/serve.deno.js
```

`COOKIE_SECRET` comes from the environment, through the config. Without one the
dev server signs with a random per-process value and says so. Production refuses,
because a server that invents its own would issue cookies a second instance
rejects, and that looks like random logouts rather than a configuration error.

## The production build

```
dist/client       hashed, minified client entries, one per route that needs JS
dist/server       the SSR bundle, plain ESM, no Vite at runtime
dist/static       prerendered HTML
dist/routes.json  what is left for the server to render on demand
```

Every route whose URLs are knowable is prerendered. A static route has one URL. A
dynamic route has as many as it says it has:

```html
<script server>
  // A named export of a <script server> block survives onto the page module,
  // so the build can ask a route which URLs it stands for.
  export const paths = () => people.map((person) => ({ name: person.slug }));
</script>
```

A route with no `paths` export is rendered by the server. A catch-all cannot list
its own URLs, so it is the kind of route the server still renders per request. When every route prerenders, `dist/static` is self-contained and any static
host will serve it; the build says so when that happens.

The prerender pass runs eight pages at a time (`TRANSCLUDE_BUILD_CONCURRENCY`).
Rendering itself is synchronous, so that alone changes nothing. Loaders wait on I/O, and a
hundred pages should not mean a hundred waits one after another. A
page that throws is reported with its URL and fails the build; it does not take
the other pages down with it.

`npm start` reads `dist/` and never the source, so an edit made since the last
build is not being served. That looks the same as the edit not working, so the
server says so on startup. `npm run preview` builds first.

`npm start` is Hono with no Vite and no compiler: prerendered HTML first, then the
few dynamic patterns, then the 404 page.

Prerendered HTML is read into memory once at startup, each page with an ETag, so a
request costs no syscalls. Assets are content-hashed and go out `immutable`; HTML gets
`must-revalidate` instead, because its URL does not change when its content does.
A repeat visit is one conditional request that comes back `304` with an empty
body. Past a 64 MB budget, pages stay routable but are read per request rather
than held, which is the right answer for a site with more pages than memory.

### Compressed at rest

The build writes `.br` and `.gz` next to every compressible file, so the server
sends bytes straight off disk instead of compressing the same page over and over:

```
10 files precompressed: 41.1 KB raw, 14.8 KB gzip (−64%), 12.0 KB brotli (−71%)
```

Brotli runs at quality 11 because nothing is waiting for it. A proxy compressing
as it sends picks 4 or 5 to keep latency down, so this output is smaller than
anything the request path could produce. It counts for more here than elsewhere,
because page and layout CSS is inlined into `<head>`. HTML is most of what ships,
and HTML is what compresses best.

Two checks keep it correct. Files below 512 bytes are skipped, because the framing
makes them bigger. One 91-byte chunk in this repo gzips to 120. And a variant is
only kept when it came out smaller.

Serving them is the part worth getting right, because the failure mode is a
corrupt response rather than a missed byte:

- `Accept-Encoding` is parsed with q-values, so `br;q=0, gzip` correctly refuses
  brotli, and an encoding the client never mentioned is never sent.
- `Vary: Accept-Encoding`. Without it a shared cache serves one encoding to
  everybody.
- Each encoding is a distinct representation and gets its **own** ETag
  (`"abc-br"`, `"abc-gzip"`, `"abc"`), so a brotli ETag cannot satisfy a gzip
  request. Verified: it returns `200`, not `304`.

A server-rendered route has no file, so it cannot be compressed ahead of time. It
is compressed on the way out instead, at brotli quality 5 rather than 11. Measured on
a rendered page, q11 costs 1.372 ms against 0.056 ms and buys 105 bytes; that
trade is right at build time and wrong with a client waiting. They get an ETag
too, computed from the rendered body, and the conditional check runs *before*
compression, so a revalidating client pays for a hash and nothing else.

Measured through a real browser, which negotiated brotli for all of it:

| | wire | decoded |
| --- | --- | --- |
| `/check` document | 1596 | 7052 |
| `check-*.js` | 1272 | 3704 |
| `user-card-*.js` | 1252 | 3087 |
| `card-list-*.js` | 478 | 923 |

There are no stylesheet requests. Page and layout CSS is inlined into `<head>` by
the document assembler and component CSS lives inside each shadow root, so the
build emits no CSS assets at all. Rollup splits out the components shared between
entries, so `user-card` is one chunk rather than three copies.

## Routing

```
app/routes/index.html            ->  /
app/routes/about.html            ->  /about
app/routes/blog/index.html       ->  /blog
app/routes/blog/[slug].html      ->  /blog/:slug
app/routes/docs/[...path].html   ->  /docs/:path{.+}
app/routes/api/people.js         ->  /api/people, an endpoint rather than a page
app/routes/404.html              ->  the not-found handler, not a route
app/routes/500.html              ->  the error page, not a route
app/routes/_draft.html           ->  ignored, as is anything under an _ directory
app/routes/_helpers.js           ->  ignored. The `_` keeps a .js file out of the table
app/routes/_layout.html          ->  wraps everything
app/routes/blog/_layout.html     ->  wraps everything under /blog, inside the root one
```

`src/routes.js` is a pure function from directory to manifest; the plugin and the
server both call it, so they cannot disagree about what exists. Routes are sorted
static, then dynamic, then catch-all, and registered in that order. Matching is
the same whatever router is underneath. Two files
claiming one URL is an error naming both, not a silent winner.

The directory holds **routes**; a page is one kind. Extension decides: `.html` is
a page, `.js` is an endpoint. It was called `pages/` until it started holding both.

A catch-all compiles to `:path{.+}` rather than Hono's `*`, because a bare
wildcard is not a named param, and `params.path` is what it exists for. Adding or
deleting a route rebuilds the table without a restart, for `.js` as well as
`.html`, which it did not at first, and a 404 was the only hint.

`/about/` redirects to `/about` with a 301 (`trailingSlash: 'never'`). One
canonical URL, because every URL the file tree produces is already slash-free.
Set it to `'ignore'` and both answer 200: two URLs for one page, and nothing
emits `<link rel="canonical">`.

The loader receives them:

```html
<script server>
  import { people } from '../../data/people.js';

  export default async ({ params, url, request, cookies, response }) => ({
    person: people.find((p) => p.slug === params.name) ?? null,
  });
</script>
```

Two things there are worth naming. That relative import works because the plugin
resolves imports inside a `<script>` block against the .html file they were
written in. The generated page module is virtual and has no directory of its own,
so Vite could not resolve them alone. And `params` is typed: the route's param names
come from the filename, with no inference involved at all.

The rest of `ctx`:

| | |
| --- | --- |
| `url` | the full request URL, as a string |
| `params` | route params, typed from the filename |
| `route` | `{ id, pattern, path }` |
| `request` | the platform's own `Request`. `null` while prerendering |
| `cookies` | read and write, signed or not |
| `response` | the status and headers this answer will carry |
| `fragment` | the region asked for, or `null` for a whole document |
| `action` | what this page's own action returned, or `null` |
| `layout` | what the layouts above returned, merged |

`request` is a `Request` and not a router wrapper on purpose: reading a form is
`await request.formData()` and nothing to look up.

## Answering more than GET

A `<form method="post">` was not reachable until `actions` existed.

```html
<script server>
  export default async ({ action }) => ({ notes, error: action?.error ?? null });

  export const actions = {
    async post({ request, cookies, fragment, url }) {
      const form = await request.formData();
      const text = String(form.get('text') ?? '').trim();
      if (!text) return { error: 'a note needs some text' };

      notes.push({ text });
      return Response.redirect(new URL(url).origin + '/notes', 303);
    },
  };
</script>
```

The action does the work. `load` still decides what renders, whatever method
asked for it. A form that comes back with an error and one that redirects are
written the same way, and neither has to restate the page's data. Returning a
`Response` answers the request directly and skips the render.

Keyed by method because `export const delete` is a syntax error and an object key
is not. A method the page does not answer gets a 405 with an `Allow` header, not a
404. The URL exists; the method does not.

Three rules, each of which was a bug first:

- An action that changes data has to answer with a redirect. Rendered markup from
  a POST leaves the browser on a POST, so every reload submits again. Use 303, not
  302. Only 303 turns the next request into a GET.
- A one-time message belongs in a cookie, not the URL. `?added=x` can be reloaded,
  shared, and outlives what it describes, so any GET of that URL reports something
  that never happened. Use a short-lived signed cookie that the loader reads and
  then deletes.
- A `Response` body can be read once, so do not share one. A module-level
  `const badRequest = new Response(...)` works for the first request and then
  answers 200 with a rendered page. Build it in a function.

## Regions

Any element in a page can be addressed on its own.

```html
<div id="list" fragment>
  <li each="note of notes">${note.text}</li>
</div>
```

```
GET  /notes?fragment=list   ->  just that <div>
POST /notes?fragment=list   ->  the action runs, then just that <div>
GET  /notes                 ->  the whole document, containing it
```

It compiles twice from the same source: once inline as part of the document, and
once on its own. The two cannot drift apart. The `id` is the name, so the word in
the URL and the word in the markup are the same word.

The framework ships no code that swaps a region into a page. A region has a plain
HTTP URL, and htmx, Turbo, or a short `fetch` can drive it. What the framework does
ship is the part those tools cannot do for themselves: when a tag appears in the
DOM that this page never rendered, `watch` imports its definition and `adoptStyles`
adds its CSS to `<head>` once.

Set `fragmentHeader: 'HX-Target'` and htmx needs no query parameter. It already
sends the target element's id, which is the same thing as a region name. This is
off by default, because turning it on adds a header to `Vary`.

## The response envelope

`ctx.response` is one object, a status and a `Headers`, shared by every loader in
the chain and by the server.

```js
export default async ({ params, response }) => {
  const person = bySlug(params.name);
  if (!person) response.status = 404;   // the page renders its own body, with a 404
  return { person };
};
```

It is shared by reference, and it has to be. Loaders are called with
`{ ...ctx, layout }`, so a value assigned onto that copy would be written to an
object nobody reads.

A loader can also return a `Response` to answer the request directly, which is the
same rule an action has. When a layout does it, nothing below it runs, so a login
redirect can live in a layout.

## Cookies and sessions

```js
cookies.get('theme');                       // string | undefined
cookies.set('theme', 'dark', { maxAge: 60 });
await cookies.signed.set('session', id);    // HMAC: readable, not forgeable
await cookies.signed.get('session');        // undefined if absent *or* forged
```

Defaults are `Path=/`, `HttpOnly` and `SameSite=Lax`, which are safer than the
values the spec falls back to. Signing is what makes a cookie usable as a session:
put an id in it and keep the rest on the server. There is no session store, because
that would require choosing a database.

`cookieSecret` comes from the config, which reads it from the environment. Only the
dev server invents one when it is missing, and it prints a notice when it does. A
production server that invented its own would issue cookies a second instance
rejects, which looks like random logouts rather than a configuration error.

## Endpoints

A `.js` file in `routes/` is a route with no template.

```js
// app/routes/api/people.js  ->  /api/people
export const GET = ({ url }) => Response.json(people);
export const DELETE = ({ params }) => new Response(null, { status: 204 });
```

Every verb reaches it. The module decides which ones it answers, and the rest get a
405 with an `Allow` header. Handlers are named the way HTTP names the method.
Uppercase matters: `export const delete` is a syntax error and `DELETE` is not.

Returning a `Response` is required. There is no template to fall back to, and a
handler that returns a plain object has forgotten `Response.json`. The `ctx` is
type checked like a page's, without the parts only a page has.

## Partials and components

Two directories, because they are two things you reach for at different moments.
Both resolve by filename with no import line, and both need a dash in the name.

```
app/partials/site-note.html     ->  <site-note>    light DOM
app/components/user-card.html   ->  <user-card>    shadow DOM
```

The words are the traditional ones. A partial has always meant "render this
markup into my context". Statamic, Rails, Blade, Liquid, Twig and Hugo all have
partials, and all of them take parameters, so props are not what separates the
two. This is: a partial is inlined into its caller, a component is kept apart
from it. Elsewhere that is a convention. Here it is a fact about the DOM.

A **partial** is markup reuse. Styles are scoped to the tag with `@scope` and
hoisted into `<head>` once; markup renders inline; page CSS reaches it; form
controls and `<label for>` work because there is no boundary.

A **component** is a widget with its own boundary. It gets a shadow root, a real
`<slot>`, and re-renders when its attributes change.

| | partial | component |
| --- | --- | --- |
| styles | `@scope (tag)`, hoisted once | inline, per instance |
| page CSS reaches it | yes | no |
| forms and `<label for>` | work | need `ElementInternals` |
| `<slot>` | compile-time hole | real, live projection |
| `<script>` | runs on connect | runs, plus re-render on attribute change |
| no `<script>` at all | ships no JS | ships no JS |

Which rendering a usage gets follows the **child's** own directory, not its
parent's, so a partial can contain a component and the reverse.

**Reach for a partial first.** A shadow root costs a copy of the stylesheet for
every instance. `adoptedStyleSheets` is JS-only, so a server render cannot share
one. Before partials existed here, component CSS was 41% of the home page, and 56%
of that was the same rules repeated. A boundary is worth that when you hand
something to a page you do not control. Inside a page you own, you pay it and get
nothing back.

**A partial is an undefined custom element, not an unknown one.** The dash makes
`<site-note>` a valid custom element name, so it is an `HTMLElement` waiting to be
defined. Define a class for that tag later and every instance upgrades in place,
with its server-rendered DOM intact.

One tag cannot be both. The scan refuses it by name, because the component would
silently win and the partial would never render.

## Layouts

`_layout.html` wraps every page in its directory and below. They nest: the root
layout wraps the directory layout wraps the page. A layout is a page that renders
a hole, and the hole is `<slot>`. It is the same word components use, doing the
same job one level up.

```html
<script server>
  export default async ({ route }) => ({ path: route.path });
</script>

<title>transclude</title>
<style>body { font: 15px/1.55 system-ui }</style>

<header><nav>…</nav></header>
<main><slot></slot></main>
<footer>Rendered on the server. <code>${path}</code></footer>
```

`<slot>` may carry fallback content, used when nothing was rendered into it. A
`<slot name="…">` is left alone. Only the default slot is the content hole. A
layout with no slot at all is a warning, since nothing inside it could ever
appear.

**Slots can be named.** A page fills its layout's default hole with everything it
renders, and any other hole with `<template slot="…">`:

```html
<!-- routes/people/[name].html -->
<template slot="aside">
  <h2>On this page</h2>
  <p if="person">${person.name} joined in ${person.since}.</p>
</template>

<!-- routes/_layout.html -->
<aside>
  <slot name="aside"><p>Pages can fill this by declaring a named slot.</p></slot>
</aside>
```

Every level renders to a slot map rather than a string, and a slot a layout does
not use itself is passed up to the layout above it. Without that, a page could
only fill a hole in its nearest layout. Named content never appears in
the default body.

**Data flows down.** Loaders run outermost first, and each level receives what the
levels above it returned as `ctx.layout`, shallow-merged with the nearer layout
winning:

```html
<!-- routes/people/_layout.html -->
<script server>export default async () => ({ total: people.length });</script>

<!-- routes/people/[name].html -->
<script server>
  export default async ({ params, layout }) => ({
    person: bySlug(params.name),
    rank: `${people.length - layout.total + 1} of ${layout.total}`,
  });
</script>
```

It flows one way only: a layout never sees the page beneath it, which is what
keeps the order well-defined. The cost is that loaders run one after another rather than at the same time. A
page cannot read its layout's data and also start before it.

`ctx.layout` is **typed**, not just passed. The chain's shapes are resolved in the
same order they run, so the page compiles against a known `layout` shape.

**The innermost `<title>` wins**, and that is a compile-time fact rather than a
regex over rendered markup: `<title>` compiles to its own `renderTitle`, separate
from the rest of the head. Everything else, such as `<meta>` and `<style>`, accumulates outermost first, so
a page can override its layout.

Layouts are why the demo pages are short. Before them, four pages each repeated
the same `body` font/background rules and their own nav.

## The global stylesheet

One file, `app/styles/global.css`, linked once. It goes through Vite, so nesting,
`@import` and PostCSS all work; The build hashes it and compresses it ahead of
time, and every page links the same one, so full-page navigation is cheap.

It is also where the shadow boundary becomes visible:

```
.tinted on a plain element     applies
.tinted on a partial           applies       light DOM, no boundary
.tinted on a component host    applies       the host is in light DOM
.tinted inside its shadow root does not      the boundary

--line declared on :root       resolves everywhere, shadow roots included
```

**A global stylesheet can theme a component, but it cannot style one.** Custom
properties inherit across the boundary; selectors do not. So tokens belong here
and reach everything, while a reset, base typography and utility classes reach
pages and partials only.

Order in `<head>` is head scripts, stylesheet, then partial `@scope` blocks, then
layout and page styles, outermost first, so anything closer to the markup wins.

### View transitions

Opt in from your own CSS. Nothing in the framework participates:

```css
@view-transition { navigation: auto; }

@media (prefers-reduced-motion: reduce) {
  @view-transition { navigation: none; }
}
```

Cross-document transitions need full-page navigation, which is what this framework
does. An SPA has to rebuild them itself. Elements that should morph
across a navigation take a `view-transition-name`, unique per document, so it
comes from the data:

```html
<a href="/people/${person.slug}" style="view-transition-name: person-${person.slug}">
```

The detail page names its heading the same way, and the browser pairs them.

**Wait for the content before transitioning.** Without this the incoming snapshot can
be taken of a half-built page. The transition still runs, on the wrong thing.
`<link>` at the top level of a layout is hoisted into `<head>`, which is where a
render-blocking hint has to be:

```html
<link rel="expect" href="#lead-content" blocking="render">
...
<main id="lead-content"><slot></slot></main>
```

The global stylesheet is already render-blocking by virtue of being a `<link>`, so
critical styles are covered; this covers critical markup.

**Why a transition sometimes does not run on a forward navigation.** Three
things, all timing:

- **One transition at a time.** A new one cannot start while another is still
  running, and the default is around 250ms. Clicking straight through two links
  skips the second. The rules below cut it to 150–200ms, which narrows the
  window as well as looking brisker.
- **The outgoing page must have rendered.** There is nothing to snapshot
  otherwise. A back navigation restores from bfcache already painted, which is
  why that direction is reliable and forward is the one that varies.
- **In dev, the first request to a route compiles it.** Measured here: 64ms cold
  against 2.8ms warm. Production serves prerendered files at well under a
  millisecond, so this is a dev-only wobble.

```css
::view-transition-old(root),
::view-transition-new(root) { animation-duration: 150ms; }

::view-transition-group(*) {
  animation-duration: 200ms;
  animation-timing-function: cubic-bezier(0.2, 0, 0.2, 1);
}
```

**Two things that skip a transition outright**, both worth knowing because neither
reports an error:

- Two rendered elements sharing a `view-transition-name`. That is why the name
  here comes from the data rather than a fixed string.
- A document whose page visibility is `hidden`. This is also why the animation
  could not be confirmed from here: under browser automation the tab is often not
  the visible one, and `pagereveal` fired exactly once across a whole session
  despite a `<script head>` listener provably running on every page.

In dev the link is the plain source path, and it hot-updates. Vite content
negotiates: a bare `.css` request with no `Accept` header gets a JS module (that
is how `import './x.css'` works), but a `<link rel="stylesheet">` sends
`Accept: text/css` and gets the stylesheet. Editing it swaps the href rather than reloading the page, so it needs no help from
the framework's own watcher.

## Middleware, and the four defaults

`app/server.js` default-exports a function handed the Hono app before any route is
registered. Plain Hono, with no wrapper to learn.

```js
export default function (app) {
  app.use('/admin/*', basicAuth({ username: 'me', password: process.env.PW }));
}
```

The order things are registered in decides how they behave, so it lives in one
function that both servers call: trailing-slash redirect, CSRF, your middleware,
public files, then routes. A guard added after the static handler would not cover a
prerendered page.

Middleware does not run during `npm run build`, so a page behind one needs
`export const prerender = false` or the build writes a logged-out copy to a file.

Four things the config decides, and the reasoning for each:

| key | default | why |
| --- | --- | --- |
| `csrf` | `true` | the whole form story is `<form method="post">`, which a cross-origin page can send. Hono's guard covers exactly that hole; JSON already needs a preflight |
| `trailingSlash` | `'never'` | one canonical URL. `strict: false` and `trimTrailingSlash` exclude each other, because the loose router strips the slash before any middleware sees it |
| `publicDir` | `'public'` | served by Hono's `serveStatic`, not the in-memory cache, because these are yours: they can be large and they can be media, which needs byte ranges |
| `fragmentHeader` | `null` | on widens the cache key, and most apps will not use it |

`compress` and `etag` are not Hono's. The build writes brotli at quality 11 next to
every file, measured at 70% smaller against gzip's 64%, and `CompressionStream` has
no brotli at all. Each encoding also gets its own strong ETag, because with
`Vary: Accept-Encoding` the plain and brotli bodies are different bytes.

## The same app on four runtimes

`src/app.js` has no `node:` imports. A test checks the whole import graph, and a
second test checks for Node-only globals, because `Buffer` is a global and the graph
check cannot see it. What differs per runtime is passed in: where bytes come from,
how to hash them, and whether the runtime can compress.

```
npm start             Node      fs, node:crypto, node:zlib
npm run start:bun     Bun       same, and Bun reads .env itself
npm run start:deno    Deno      same, but needs --env-file
npm run start:worker  workerd   no filesystem, so bytes come from an emitted module,
                                  hashing from WebCrypto, compression from the edge
```

All four answer the same way over ten routes: same 301, same 403 on a forged post,
same `Set-Cookie`, same 304. There is one difference. A worker cannot serve byte
ranges, because that needs a filesystem.

Two things only running it revealed:

- Config arrives with the request, not the process. There is no `process.env`, so a
  secret read at import time is `undefined` and signing refuses. That is correct and
  confusing at the same time, because the variable is set.
- Workers has no JSON module type. `routes.json` arrives as a string, and using it
  as an object gives a route table of `undefined` and a site of 404s that looks like
  a routing bug.

## Browser checks

Some things can only be answered by a browser. They live in `demos/everything`,
because they need an app to run against. `/check` is a page of assertions that
runs a classic inline script while the page is parsing, before any module runs,
so it can look at the document before a single component is defined.

All 53 pass in Chrome 150, Safari 26.4 and Firefox 152. The ones that prove the
most:

| check | why it proves something |
| --- | --- |
| a region renders the same inline and on its own URL | the swap cannot drift from the page it replaces part of |
| an adopted partial's styles land before the page's own | so a page still overrides an element it did not render |
| the parser attached a real shadow root from the DSD template | asserted with `customElements.get(...) === undefined`, so nothing had upgraded yet |
| upgrade adopted the shadow root instead of repainting | compares DOM node identity across the upgrade, not markup |
| re-render keeps nested shadow roots alive | swapping `setHTMLUnsafe` for `innerHTML` makes exactly this one fail, with 2 dead `<template>` nodes left behind |
| a reorder keeps the value, focus and caret in an input | Safari has no `moveBefore`, so it is the browser that runs the fallback path |

Open `/check?report` and the run is posted to an endpoint that prints it in the
server log. That is how Safari and Firefox were measured: neither can be driven
from a shell without setup, since Safari needs "Allow remote automation" turned
on by hand and Firefox needs geckodriver installed. Posting the results needs
neither.

Run them with `npm run demo` and open `/check`. The demo installs this package
from `file:../..`, so a change here is in the next `npm run dev` with no publish
step in between.

## Giving an element behaviour

A `<script>` block in a partial or a component is its behaviour. `host` and
`shadow` are in scope. `shadow` is `null` for a partial, which has no shadow root.

```html
<script>
  const onKey = (event) => {
    if (event.key === 'Escape') host.hidden = true;
  };
  document.addEventListener('keydown', onKey);

  // Returning a function is how cleanup is declared. It runs when the element
  // leaves the document. Without it this listener would outlive the element.
  return () => document.removeEventListener('keydown', onKey);
</script>
```

The block compiles to `init(host, shadow)`, which runs on every connect, and
whatever it returns runs on every disconnect. Every time rather than once, because
moving an element in the DOM disconnects and reconnects it. Behaviour torn down on
the way out has to come back on the way in.

The block is an async function body, so a top-level `await` works and the return
value may be a promise.

Two things worth knowing:

**A component re-renders; its shadow content does not survive.** Attach listeners
to `host`, or delegate. A listener bound to something inside the shadow root is
lost the next time an attribute changes. A partial never re-renders, so its
children are stable.

**No script means no registration.** An element without a `<script>` is never
defined and ships no JavaScript at all; it is markup that was already rendered.

## Properties

Accessors are generated from `<script properties>`. You declared the shape there;
writing a getter and setter for each would be saying it twice.

```html
<script properties>
  export default { name: "Anonymous", tags: [], compact: false, pageSize: 10 };
</script>
```

```js
const card = document.querySelector("user-card");

card.name;                 // "Ada Lovelace"  read and coerced
card.tags = ["a", "b"];    // stored as JSON, re-rendered
card.compact = true;       // presence, not the string "false"
card.pageSize;             // 10              attribute is `page-size`
```

**camelCase in, dash-case out.** HTML lowercases attribute names, so `pageSize`
is written `page-size`. Lit has the same rule, for the same reason. Before this
existed a camelCase prop silently never received its attribute at all: it fell
back to the default while the raw string leaked through under the lowercased key.

**The attribute is the only state.** A getter reads and coerces it; a setter
writes it, which for a component triggers `attributeChangedCallback` and a
re-render, and for a partial drives attribute selectors in CSS. Nothing is
copied, so nothing can drift. The server only ever sees attributes, and the client
reads the same ones.

That is the difference from Lit, which keeps property state separately and
reflects to the attribute on request. Here reflection is not a setting because
there is nothing to reflect.

**Accessors exist wherever the element is defined**, which means it has a
`<script>`, or it is a component. A partial with no script is markup that was
already rendered and ships no JavaScript. There is no class, so there are no
properties.
Read its attributes directly, or give it a `<script>` if it needs an API.

## A component that a form submits

A custom element in a `<form>` sends nothing by default. One line turns it on:

```html
<script properties>
  export default { value: '' };
</script>

<script>
  export const formAssociated = true;
  internals.setValidity({});
</script>
```

Declare a `value` prop and the framework does the rest: `attachInternals()`,
`setFormValue` on every change, and `formResetCallback`, `formDisabledCallback` and
`formStateRestoreCallback`. `internals` is the fourth thing a `<script>` block gets,
after `host`, `shadow` and `signal`. A light element can opt in too, because being a
form control does not need a shadow root.

It has to be a literal. It becomes a `static` class field, which is the same for
every element of that tag, so a computed value would look like a per-element choice
and could not be one.

Two details that were wrong at first:

- The value is reported before the render. A form can be submitted between an
  attribute changing and the microtask that repaints, so what it sends has to match
  what the attribute already says. It is serialized the same way the attribute is,
  so objects become JSON rather than `[object Object]`.
- `formResetCallback` removes the attribute instead of setting it to an empty
  string. Removing it is what makes the getter fall back to the declared default.


## Something in `<head>`

`<script head>` is emitted verbatim into `<head>`, ahead of the stylesheet:

```html
<script head>
  document.documentElement.dataset.theme = localStorage.theme ?? 'light';
</script>
```

For the things that have to run before the body parses: a theme applied before
first paint, an analytics snippet, a `pagereveal` listener. A `<link>` blocks the
scripts after it, which is why these go first.

## Shipping only what is used

A page ships definitions for the components it actually renders, and nothing else.
The set covers the page and its layouts, and follows nesting all the way down. A
re-render emits its children's markup too, so anything that can be reached needs
its definition to upgrade.

```
/                      user-card, data-table
/people/:name          card-list, user-card     (user-card only reachable via card-list)
/docs/:path            no client JS at all
/nope                  no client JS at all
```

A page that renders no components and has no `<script>` gets no module script
element in the document. Not an empty bundle. No tag.

## The file format

```html
<script server>                 <!-- page only, never shipped to the browser -->
  export default async ({ url }) => ({ posts: await db.posts.all() });
</script>

<script properties>             <!-- defaults imply the types -->
  export default { name: 'Anonymous', tags: [], compact: false };
</script>

<script state>                  <!-- component only: not in the document -->
  export default { clicks: 0 };
</script>

<style>                         <!-- component: shadow root. page: <head> -->
  :host { display: block }
</style>

<h3>${name}</h3>                <!-- everything else is the template -->
<li each="tag of tags">${tag}</li>

<script>                        <!-- client code; `host` and `shadow` in scope -->
  export const prototype = {    // the element's own API, on the prototype
    get tagCount() { return this.tags.length },
    toggle() { this.compact = !this.compact },
  };

  host.addEventListener('click', () => host.toggle());
</script>
```

A component is just `app/components/<tag>.html`. There is no import line. The filename is
the tag, so `user-card.html` makes `<user-card>` available everywhere. The name
must contain a dash.

## Decisions this encodes

**The file stays valid HTML.** Directives are attributes, so parse5 gives a
correct tree for free and Prettier/Emmet/linters keep working. That is the only
thing separating this from "a nicer PHP".

**Everything is escaped.** `${x}` always escapes; `${html(x)}` is the sole opt
out and it is a runtime marker object, not a string convention. Attribute values
escape separately with attribute rules.

**`false` / `null` / `undefined` drop an attribute** rather than stringifying, so
you never get `class="false"`. `true` emits a bare boolean attribute. Objects and
arrays serialize as JSON, which is what lets the browser read a prop back off the
element and re-render with the same data the server had.

**`else` binds across whitespace and comments**, and an `else` with no `if` is a
compile error with a line number, not an element that quietly disappears.

**`if` + `each` on one element is a hard error.** Vue 2 and Vue 3 disagreed about
which runs first and it confused everyone. Wrap one in a `<template>` and the
intent is explicit.

**Conditions are expressions, not strings.** `if="0"` is false. jsep supplies a small
grammar with no assignment, no arrow functions and no object literals. That keeps
templates declarative rather than a second place to write code, and it is what
makes collecting the names a template reads possible at all.

**A `<template>` carrying a directive is consumed; one without any is emitted
verbatim.** So `<template if="...">` is a fragment, and `<template id="row">`
survives to the browser for `content.cloneNode(true)`.

**Comments are stripped** from output but still count as insignificant when
linking an `else` to its `if`.

**Nested loop names shadow, with a warning.** Inner wins; the compiler tells you
the outer one became unreachable.

## Things that bit us, kept as notes

`<template>` children live on `.content.childNodes`, not `.childNodes`. A naive
recursive walker skips everything inside every template and the directives look
like they silently do not fire. `childrenOf()` in `codegen.js` is the fix.

`<template>` is the only fragment wrapper allowed inside `<tr>`. Anything else is
foster-parented out of the table by the parser before the compiler ever sees it.
`data-table.html` relies on this.

`shadowRoot.innerHTML` does not process nested shadow root templates. A component
holding another component would end up with dead `<template>` nodes in the DOM. `defineComponent` uses `setHTMLUnsafe()`.

**HTML parses before interpolations do.** `${html('<strong>hi</strong>')}` in text
position fails, because the parser sees a real `<strong>` start tag and cuts the
expression in half. Use entities (`&lt;strong&gt;`) or, better, put the markup in
data. This is the tax for staying valid HTML, and it is worth paying.

Component modules are exposed as `virtual:transclude-component/<tag>` rather than as real
file paths. Vite's html middleware would otherwise intercept a request for
`/app/components/user-card.html` and try to serve it as a page.

## Layout

The package at the root, and apps built against it under `demos/`.

```
package.json               its exports, its bin, its own dependencies
bin/dev.js                 Hono + Vite middleware, routes from the manifest
bin/build.js               client bundle, SSR bundle, prerender pass
bin/serve.js               Node adapter: three lines over src/production.js
bin/serve.bun.js           Bun adapter
bin/serve.deno.js          Deno adapter
bin/check.js               transclude-check
editor/server.js           language server: diagnostics and hovers, no deps
editor/vscode/             grammar and extension
src/plugin.js              Vite plugin, virtual module ids, registries
src/routes.js              directory tree -> route manifest (pure)
src/app.js                 the app itself: zero `node:` imports, all injected
src/production.js          the Node wiring for it: fs, crypto, zlib
src/worker.js              the wiring a runtime with no filesystem needs
src/project.js             finds the project root and loads its config
src/server.js              the Hono app dev and production both start from
src/cookies.js             read and write, signed or not
src/document.js            slot folding, head merging, document shell
src/typecheck.js           in-memory shims, TypeScript language service
src/compiler/
  shim.js                  .html -> checkable .js, with source mapping
  index.js                 block splitting, module assembly
  codegen.js               parse5 walk -> render function body
  expr.js                  jsep AST -> JS source, scope chain
  script.js                acorn rewriting of <script> blocks
  types.js                 transclude-env.d.ts assembly, from tsc's type strings
  interp.js                ${...} splitting, quote-aware
src/runtime/index.js       escape/attr/coerce, shadow(), defineComponent()
src/static-cache.js        built output in memory, one ETag per representation
src/negotiate.js           Accept-Encoding parsing, q-values and all
src/compress.js            build-time brotli and gzip
src/pool.js                bounded concurrency, order preserving
test/                      515 tests, and they need no app
demos/everything/          an app, on the far side of the boundary
```

A demo is an ordinary app. It depends on the package by name, and a test says
nothing in the package reaches into `demos/`:

```
demos/everything/
  package.json             "transclude": "file:../.."
  transclude.config.js     where the app is. The whole interface
  worker.js                its workerd entry, wiring transclude/worker
  test/                    its own tests, about its build output and its wiring
  app/
    routes/                pages, endpoints, layouts, the 404 and 500
    server.js              its own Hono middleware
    public/                served as-is at the root: favicon, robots.txt
    partials/              light DOM, @scope styles
    components/            shadow DOM, with their own boundary
    styles/global.css      tokens, reset, base typography. One linked file
    transclude-env.d.ts    generated by transclude-check
```

Nothing here imports anything above itself, and nothing here imports
`transclude.config.js`. A test checks module specifiers for both, reading
specifiers rather than text so that an error message may still name the config
file.

Two things used to break that and were the whole of the separation. Six files
imported the config by relative path, and four worked out the project root as two
directories up from their own location. Both are true only while the framework
sits inside the app it serves. Installed, two directories up is another package.
`src/project.js` is the one place that answers either question now: the root comes
from where the command was run, and the config is loaded from there.

The worker entry moved to the app for the same reason. Every import in it names
something the app owns, so what a worker does differently from Node is
`transclude/worker` and the wiring is the app's.

## Script blocks

Blocks are written as real modules and rewritten with acorn, never with a regular
expression. Every edit happens at a range the parser found. So `// export
default ...` in a comment stays a comment, a multi-line `import { a, b } from` is
lifted whole, and `await import()` is not mistaken for a declaration.

| block | becomes | may import | may export |
| --- | --- | --- | --- |
| `<script server>` | `load(ctx)` on the page module | yes | named only, non-reserved |
| `<script properties>` | `propDefs` + `propShape` | yes | named only, non-reserved |
| `<script state>` | `stateDefs` | yes | named only, non-reserved |
| `<script>` in a component | `async init(host, shadow, signal)` | yes, hoisted | `prototype` only |
| `<script>` in a page | the client entry module | yes | no |

`export const prototype` is the one export a client block may make. It is not
setup code. Its members land on `Class.prototype`, so they are shared by every
element and reach their own element through `this`. Anything it reads is hoisted to
module scope with it; anything it cannot reach is an error rather than a
surprise:

```
card.html <script>: `prototype` reaches `host`, which exists once per element.
Members live on the prototype and are shared by every instance, so they reach
their own element through `this` instead (line 4)
```

Named exports survive, so page-level config (`export const revalidate = 60`) is
already possible. Exporting a name the generated module already
defines, such as `css`, `render`, `load` or `propDefs`, is a compile error that
names the clash rather than an override nobody can see.

Parse errors report the line **in the .html file**:

```
index.html <script server>: Unexpected token (line 5)
```

Hoisted imports are blanked in place rather than deleted, so line and column
numbers still match the source after rewriting.

## Types

TypeScript does the checking, and TypeScript writes the types. There is no
inference of our own left.

`npm run check` turns each `.html` file into a shim, held in memory. The shim is
JavaScript that means the same thing. tsc checks it, and the errors are mapped
back to the `.html` source:

```
app/routes/people/[name].html:33:28  error  TS2551
  Property 'notes' does not exist on type '{ slug: string; name: string; … }'. Did you mean 'note'?

    <p class="note">${person.notes}</p>
                             ~~~~~
```

The shim is built from chunks. Some text is generated, and some is copied from the
source with the offset it came from, so an error traces back to the exact token. Narrowing, generics, unions, `Did you mean`, and hovers all come
from tsc rather than from us.

Four decisions make it work:

**The shim is `.js`, not `.ts`.** A JSDoc `@type` in the author's own
`<script properties>` is honoured in a `.js` file and silently ignored in a `.ts` one.
The job is to check what the author wrote, so the shim speaks the same language
they do. Its own scaffolding is JSDoc too.

**`@satisfies` rather than an annotation.** It contextually types the loader's
parameter from the route context *and* leaves the return type inferred for the
template. An annotation would flatten one or the other.

```js
/** @satisfies {(ctx: { params: { name: string }; layout: { total: number }; … }) => unknown} */
const __default = (async ({ params, layout }) => ({ … }));
/** @typedef {Awaited<ReturnType<typeof __default>>} __Data */
```

**Shims are self-contained.** Route contexts and component props are written
into the shim as type literals rather than imported from `transclude-env.d.ts`, because
`transclude-env.d.ts` is generated from the shims. It cannot be both an input and an
output.

**Helpers arrive as parameters.** `html`, `__expr` and the per-component prop
checkers are parameters of the generated template function, so they shadow: an
author importing something called `html` cannot collide with them.

### Order of resolution

Types are derived in the only order that resolves, each step asking tsc what the
last one produced:

```
components        depend on nothing
  -> layouts      each depends on the layouts above it
    -> pages      depend on their whole layout chain
```

A nearer layout wins on a name collision, expressed as `Omit<A, keyof B> & B`.

### Where inference is not enough

JSDoc is the escape hatch, and it stays valid JavaScript:

```html
<script properties>
  export default {
    /** @type {{ name: string; role: string; tags: string[] }[]} */
    people: [],
  };
</script>
```

That annotation is doing real work. `people: []` on its own is `never[]` to
TypeScript, which is the right reading, because an empty array says nothing about
what goes in it.

### `transclude-env.d.ts`

Written by `npm run check` from what tsc made of each file. Nothing downstream
reads it; it exists for the author and the editor.

```ts
export type CardListProps = {
  heading: string;
  people: {
    name: string;
    role: string;
    tags: string[];
  }[];
};

export type PeopleNameContext = { url: string; params: { name: string }; … };
export type PeopleNameData = { person: { slug: string; … } | null; … };

declare global {
  interface HTMLElementTagNameMap {
    "user-card": HTMLElement;
  }
}
```

The tag name map means `document.querySelector('user-card')` is typed in plain
JS. `jsconfig.json` is what makes an editor pick the file up.

### Editor support

`editor/server.js` is a language server that any LSP-capable editor can
run. It is hand-rolled JSON-RPC with no dependencies. It reports diagnostics as you
type, from the buffer rather than from disk, and answers hovers:

```
hovering ${person} in the template
  (property) person: { slug: string; name: string; … } | null
```

`editor/vscode/` adds a TextMate injection grammar that highlights
`${…}` as JavaScript, colours `each`/`if`/`else-if`/`else` as keywords, and treats
`<script server>` and `<script properties>` as JS, plus an extension that starts
the server for any HTML file in the workspace.

`.vscode/settings.json` turns `html.validate.scripts` off, and has to: VS Code's
built-in HTML support concatenates every `<script>` in a file into one virtual
module, so a file with a `<script properties>` and a `<script state>` looks like
two default exports and a `<script>` block looks like it references an undefined
`host`. Both are correct code.

### What the compiler still checks itself

Three things that are not type errors, so tsc has no opinion on them:

- `if` and `each` on one element, and an `else` with no `if`. Structure, not types
- a loop variable shadowing an outer one
- a prop declared in `<script properties>` but never read in the template, `<style>`
  or `<script>`

## Known limits

- No client-side navigation, and no swapper. Every link is a full document
  request unless you bring something that swaps. That is a decision, not a gap.
- No streaming. `sendRendered` buffers the whole body to hash it, which is what
  buys a strong ETag; streaming would trade that away.
- No session store. Signed cookies are the building block. A store would need a
  choice of database that this does not make.
- No byte ranges on a worker. A Range request gets 200 rather than 206. Ranges are
  what a filesystem buys, and a worker has none.
- A form inside a shadow root is invisible to a document-level listener, because
  `submit` does not cross the boundary. Listen on `shadow`.
- Server-rendered responses are compressed per request rather than at rest, and
  nothing caches the render itself. Whether a URL's output is stable enough to
  cache is a fact about the application's data, not about the framework.
- Layout loaders run in sequence, not in parallel, because each one can read what
  the ones above it returned.
- A partial upgrades so its script runs, but it never re-renders. Repainting would
  destroy the children the page put inside it. Re-rendering on an attribute change
  needs a shadow root.
- `@scope` is soft scoping. A partial's styles can be overridden by page CSS of
  equal specificity: a feature for content, a hazard for widgets.
- Entry scripts live in `bin/` because a `check.js` at an app's root hides its
  `/check` route. Vite matches a bare path against root files by extension.
- `transclude-check` is a separate step. The dev server compiles without it, so a
  type error does not stop a page rendering. It stops the check.
- The unused-prop check word-matches `<style>` and `<script>`, so a prop
  mentioned incidentally in either is assumed used.
- Chrome, Safari and Firefox are measured. Nothing older is, and no mobile browser
  is. `/check?report` in `demos/everything` is how to add one.
- `npm test` at the root does not run the demo's tests or its browser checks.
  `npm run test:demos` does the first. The second needs a browser and a person.
- In dev, Vite logs `Failed to load url /theme.js` for a `<script head src>` that
  points at a public file. Vite does not own that file, Hono serves it, and the
  browser gets it. The warning is wrong and there is no way to turn it off
  without letting Vite serve the public directory, which is the dev and
  production split this avoids.
- `wrangler dev` is workerd locally. Nothing here has been deployed to an edge, so
  the runtime semantics are verified and the platform is not.
- The demo's notes live in memory and reset on restart. Storage is not the point
  of the demo, but it does mean a restart looks like data loss.
- Published as version 0.1.0 and installed from a path, not from a registry. The
  exports map is the public surface and nothing has depended on it from outside
  one repository yet.
