# The server

The server is [Hono](https://hono.dev). An app adds its own middleware in
`app/server.js`.

```js
// app/server.js
export default (app) => {
  app.use('*', async (c, next) => {
    await next();
    c.res.headers.set('X-Served-By', 'transclude');
  });
};
```

It runs before anything that serves bytes, so a guard there covers prerendered
pages and public files.

## Hono's documentation

Hono publishes its documentation in a form an agent can read. Fetch it rather
than recall it. The dependency is `hono@^4`, and it moves.

| URL | Size | What it holds |
| --- | --- | --- |
| `https://hono.dev/llms.txt` | 6 KB | An index. Every page, one line each. |
| `https://hono.dev/llms-small.txt` | 190 KB | The core: routing, the `Context`, middleware, the helpers. |
| `https://hono.dev/llms-full.txt` | 360 KB | All of it, a page per built-in middleware. |

Read `llms.txt` and follow the one link the question needs. The other two are
whole manuals, and a question about `cors` does not need one.

### What this framework already answers

Most of Hono's surface has an answer here, and reaching past it is the common
mistake. A route registered by hand answers requests. The build, the sitemap
and `npm run check` never see it.

| In Hono | Here |
| --- | --- |
| `app.get('/notes', …)` | `app/routes/notes.html` |
| `c.req.param('id')` | `params.id` in the loader |
| `c.req.query('q')` | `new URL(url).searchParams` |
| `c.req.formData()` | `request.formData()` in a verb export |
| `getCookie(c, 'theme')` | `ctx.cookies` |
| `csrf()` | on by default, `csrf` in the config |
| `secureHeaders()` for a policy | `csp` in the config |
| `trimTrailingSlash()` | `trailingSlash` in the config |
| `compress()`, `etag()` | both are built in, per response and at rest |
| `cache()` | `export const revalidate` |
| `serveStatic()` | `app/public/` |
| `c.executionCtx.waitUntil(p)` | `ctx.after(p)` |
| `c.html()`, `hono/html`, `hono/jsx` | a page is an `.html` file |
| `hono/ssg` | `npm run build` |

Hono's `Context` reaches an app in one place, the middleware in `app/server.js`.
A loader, an action and an endpoint are handed `ctx`, which belongs to this
framework and carries no `c`. Reading a form should not cost an author a
router's API.

### What is still Hono's

`app` in `app/server.js` is a real Hono instance, so its built-in middleware
works unchanged: `cors`, `basicAuth`, `bearerAuth`, `logger`, `bodyLimit`,
`ipRestriction`, `requestId`, `timeout`, `timing`. So do the helpers `accepts`,
`conninfo` and `streaming`.

`app.request()` in a test is Hono's too. See [Testing](#testing).

## Cookies

`ctx.cookies` reads and writes.

```js
export default async ({ cookies }) => {
  const theme = cookies.get('theme') ?? 'light';
  return { theme };
};

export const POST = async ({ cookies, request }) => {
  const form = await request.formData();
  cookies.set('theme', String(form.get('theme')), { maxAge: 31536000 });
  return Response.redirect('/', 303);
};
```

`cookies.signed.get` and `cookies.signed.set` need `cookieSecret` in the config.
A signed cookie can be read by the client and not forged, which is what a
session needs. Without a secret, `cookies.signed` throws.

`Secure` follows the connection, so `http://localhost` works in dev and a
proxied TLS connection still gets it.

**Reading a cookie makes a page personal.** It is then not cached and not
prerendered. Writing one does not.

## Security

CSRF is on by default. A Content-Security-Policy is not:

```js
export default {
  csp: true,
};
```

Each page gets a policy built from the hashes of what that page inlines. There
is nothing to stamp and no nonce to thread through.

Every `${…}` is escaped. `html(value)` turns that off for one value and
sanitizes nothing, so never wrap anything a visitor typed.

`frame-ancestors`, `report-uri`, `report-to` and `sandbox` are ignored in a
`<meta>` tag, so they ride in a response header. A static host serves the meta
half and not the header.

## Types

```sh
npm run check
```

Runs TypeScript over every `.html` and `.js` route. With no annotations it
catches a misspelled field in a template, an unknown prop on an element, and a
prop given the wrong type. `strict: true` in the config turns on full
strictness.

Source is JavaScript with JSDoc. Do not convert it to TypeScript.

## Configuration

`transclude.config.js` at the project root. An unknown key throws.

| Key | Default | What it does |
| --- | --- | --- |
| `appDir` | `'app'` | Where the app lives, relative to the project root. |
| `routesDir` | `'routes'` | Pages and endpoints. Relative to `appDir`. |
| `elementsDir` | `'elements'` | Custom elements. Relative to `appDir`. |
| `iconsDir` | `'icons'` | One SVG file per icon, compiled to `/icons.svg`. A subdirectory is a library at `/<name>.svg`. Relative to `appDir`. |
| `publicDir` | `'public'` | Copied to the site root as-is. Relative to `appDir`. |
| `outDir` | `'dist'` | Where the build writes. |
| `stylesheet` | — | One global stylesheet, relative to the project root. |
| `port` | `1960` | Dev and production both listen here. `PORT` wins. |
| `lang` | `'en'` | The `lang` on `<html>`. |
| `strict` | `false` | Full TypeScript strictness. |
| `csrf` | `true` | `false` to turn it off, or an object for `hono/csrf`. |
| `csp` | `false` | `true`, or `{ directives, reportOnly }`. |
| `speculate` | `false` | `true` emits speculation rules. See below. |
| `cookieSecret` | `null` | Signs cookies. |
| `fragmentParam` | `'fragment'` | The query parameter that asks for a fragment. |
| `fragmentHeader` | `null` | A request header that may name one. Adds it to `Vary`. |
| `watchElements` | `false` | Defines and styles an element arriving in a swap. |
| `trailingSlash` | `'never'` | `'never'` redirects. `'ignore'` serves both. |
| `metadataBase` | — | The origin `ctx.absolute()` resolves against. |
| `sitemap` | `false` | `{ hostname }` mounts `/sitemap.xml`. |
| `feed` | `false` | `{ hostname, title, items }` mounts a feed. |
| `proxy` | `false` | `{ allow: [...] }` for cross-site includes. |
| `cache` | — | Where a page held by `revalidate` is kept. A bounded map in this process by default. |
| `precache` | `false` | `true` writes `/precache.json`. |
| `onError` | `null` | `(error, { request, url, method })` per failed request. |


### speculate

`true` writes a `<script type="speculationrules">` block into every page, so the
browser can fetch or render the next document before the reader clicks. No
JavaScript of the framework's is involved.

The split matters and the build decides it. A URL prerendered to a file has no
loader left to run, so it goes in `prerender`. Every route the server still
renders goes in `prefetch` only, because its loader may read a cookie or count a
view and a prerender would run that for a reader who never clicked. Endpoints are
in neither.

```js
speculate: { eagerness: 'moderate', exclude: ['/logout'] }
```

`eagerness` defaults to `moderate`, which waits for a hover. `exclude` is matched
against the emitted pattern, so a route `/docs/:path{.+}` is excluded as
`/docs/*`.

## The build

```sh
npm run build
```

Writes `dist/`. Every route with no per-request state is rendered to a file. Add
this to a page that has to run for each request:

```js
export const prerender = false;
```

**`export const draft = true` keeps a page out of the build.** `npm run dev`
serves it, because the dev server reads the directory. The build writes no file,
puts no route in the manifest and no line in the sitemap, and prints what it
skipped. Deployed, the URL is a 404. Publishing is deleting the line.

`prerender` is read off the page, never off its layouts. A layout that reads a
cookie makes every page under it request-dependent, and nothing says so.

## Holding a render

Between a file written once and a render on every request, there is a page held
for a while.

```js
// app/routes/notes.html
export const prerender = false;
export const revalidate = 3600;
```

The number is seconds. Inside that window a request is answered from the store
and the loader does not run. Past it the held page goes out immediately and a
fresh one renders behind the response, so nobody waits for a re-render. One
render happens at a time per URL, however many requests arrive together.

The key is the path and the query, because a page reading `?q=` renders
differently for each one. A rebuild that throws leaves the held page where it is,
and the error goes to `onError` with the request that started it.

Three things hold nothing:

- **`npm run dev`.** The dev server renders every request and keeps nothing
  between them. A window has no effect there at all.
- **A page the build wrote to a file.** The static handler answers before the
  route handler that holds anything, so the window never runs. Adding
  `prerender = false` puts the page back on the path that has one, which is why
  the example above carries both lines.
- **A fragment.** `?fragment=list` is rendered on demand, for every route,
  prerendered or not.

**What is never held:** a page that read a cookie, set a header, answered with a
`Response`, or has a status outside 2xx. A shared store holding any of those
hands one visitor's page, or one visitor's `Set-Cookie`, to the next. It is the
same rule the build uses to decide a route can be a file.

### Tags

Seconds say when a page may be out of date. A tag says when it is.

```js
// app/routes/notes.html
export const prerender = false;
export const revalidate = { seconds: 3600, tags: ['notes'] };

export default async () => ({ notes: await notes.all() });
```

```js
// app/routes/api/notes.js
export const POST = async ({ request, revalidateTag }) => {
  await notes.add(await request.json());

  // Every held page carrying this tag is dropped. The next request for one
  // renders it again.
  revalidateTag('notes');

  return new Response(null, { status: 204 });
};
```

`ctx.revalidateTag` belongs where the change was written, which is an action or
an endpoint: whatever made the change is what says it happened. A prerendered
page's loader calling it stops the build, since a build holds nothing yet to
drop.

`revalidate` takes a number of seconds, or `{ seconds, tags }`. Anything else
throws when the app starts. `revalidate: '1h'` would otherwise hold forever or
not at all, and say nothing either way.

The default store is a bounded map in this process. That is right for one server
and wrong for several: each holds its own copy, and `revalidateTag` reaches one
of them. `cache` in the config takes anything with the same `get`, `set`,
`delete` and `deleteByTag`.

## Runtimes

The same app runs on Node, Bun, Deno and workerd. `bin/serve.js`,
`bin/serve.bun.js` and `bin/serve.deno.js` only listen.

**workerd refuses to compile WebAssembly at runtime.** A loader that reaches
something built on Wasm fails there and nowhere else. A prerendered page never
runs its loader in production, so this stays hidden until something asks for a
fragment.

### worker.js

```js
import { workerFrom } from '@transclude/core/worker';
import * as bundle from './dist/server/assets.js';
import * as entry from './dist/server/entry.js';
import manifest from './dist/routes.json';
import config from './transclude.config.js';

export default workerFrom({ config, manifest, entry, bundle });
```

The imports stay in the app: a bundler needs a literal path. `workerFrom` builds
the app on the first request, which is when `env` exists, and takes
`cookieSecret` from `env.COOKIE_SECRET`. For anything else, call `createApp`
from `@transclude/core/app` directly.

### Bindings

`ctx` has no `env`. It carries nothing that names one runtime, and `env` names
one: the other three fill that slot with something else. A KV namespace, a D1
database or a secret reaches a loader through the app instead.

`worker.js` belongs to the app and does get `env`. Hold it in a module and
import that.

```js
// app/lib/bindings.js — no `node:` imports, this ends up in the worker bundle
// A symbol in the global registry, not a module variable. The build inlines a
// copy of this file into the server bundle and wrangler bundles `worker.js`
// with a second one, so a module variable is written in one copy and read in
// the other.
const SLOT = Symbol.for('app.bindings');

export const hold = (env) => {
  globalThis[SLOT] = env;
};

export const bindings = () => {
  const current = globalThis[SLOT];
  if (!current) throw new Error('No bindings: this app is running off workerd.');
  return current;
};
```

`worker.js` calls `hold(env)` inside `appFor`, before the `app ??=` line. A
loader then imports `bindings` and reads `bindings().DB`.

Module scope is safe here because `env` is one object for the life of the
isolate. Holding a `Request` the same way is not, since two visitors would share
whichever arrived last.

**A page that reads a binding needs `prerender = false`.** The build runs on
Node, where nothing calls `hold`, so the build runs that loader and throws.

### ctx.after

`after(work)` takes a promise the reader does not wait for.

```js
export const prerender = false;

export default async ({ after, url }) => {
  after(recordView(url));
  return { notes: await notes.all() };
};
```

On workerd this is `waitUntil`, which keeps the isolate up past the response.
Node, Bun and Deno keep running anyway, so it changes nothing there.

It takes the promise, not a function returning one. A function is refused, since
wrapping one would resolve to the function and run nothing.

A rejection goes to `onError` with the request that started it. Nothing awaits
this work, so leaving it would end the process on Node.

Calling it from a prerendered page stops the build: a file has no response to
outlive. `prerender = false` is the fix, as it is for a binding.

## Testing

The app is a function from a request to a response.

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from '@transclude/core/production';

test('the notes page lists notes', async () => {
  const res = await app.request('http://localhost/notes');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /<li/);
});
```

`app` is a named export, and the URL has to be absolute. A relative one skips
the origin checks a real request goes through.

Nothing is stubbed. `node --test` does not read `.env` the way `npm start`
does, so add `--env-file-if-exists=.env` to the test script when the config
reads a secret.
