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

`prerender` is read off the page, never off its layouts. A layout that reads a
cookie makes every page under it request-dependent, and nothing says so.

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
/** @type {Env|null} */
let current = null;

export const hold = (env) => (current = env);

export const bindings = () => {
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
