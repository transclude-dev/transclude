# Auth

A signed-cookie session, and one layout that guards everything below it.

```sh
npm install
npm run dev     # http://localhost:1968
```

Sign in as `ada@example.com` with the password `correct horse`.

## The guard is a layout

`app/routes/admin/_layout.html` returns a `Response`:

```js
export default async ({ layout, url }) => {
  if (!layout.user) return Response.redirect(new URL('/login?next=…', url), 303);
  return { user: layout.user };
};
```

A layout loader answering with a `Response` answers the request, and nothing
below it runs: not its own markup, and not the page's loader. So the pages in
`admin/` check nothing. Adding a page there puts it behind the guard, and
forgetting to check is not a thing you can do.

## The cookie holds an id, and is signed

The browser can read the id. Signing is what stops it inventing one: send
`session=1` by hand and the guard turns you away, because the value carries no
signature it can verify. `HttpOnly` on top, since nothing on the client reads
it.

Everything else about the user stays on the server. `cookieSecret` is what makes
`cookies.signed` work at all; without it, reading one throws rather than quietly
accepting an unsigned value.

## What the build does about it

The root layout reads the session, because the header says who you are. That
makes **every page under it different for each visitor**, so none of them can be
written to a file.

The build says so and stops:

```
2 pages failed to render:
  /
    read a cookie, so it is different for each visitor and cannot be one file.
    Give it `export const prerender = false`, or stop reading the cookie here
    or in what it includes
```

It exits non-zero and writes nothing, rather than shipping a signed-out copy of
your home page. That is why every page here carries `export const prerender =
false`.

Read a cookie in a *narrower* layout and only that section pays for it.

### Except the 404

An error page has to be bytes. One that renders when a request has already
failed can fail too, so it is written at build time whatever it says about
`prerender`. At build time there is no request, and `ctx.request` is `null` —
the only time it ever is.

So the layout checks:

```js
export default async ({ cookies, request }) => {
  if (!request) return { user: null };
  ...
};
```

Without that, the build reads a signed cookie with no visitor and no secret, and
fails with `reading a signed cookie needs a secret`. That is exactly what
happened in CI, where there is no `.env`.

## Small things worth copying

**Signing out is a POST.** A link that signs you out is a link anything else can
follow on your behalf. A `GET /sign-out` answers 405.

**One message for both failures.** A different answer for an unknown address and
a wrong password tells someone which addresses have accounts here.

**`next` is a path, not a URL.** `new URL(next, url)` on a value from a form
would send someone to another origin with your own redirect. Anything not
starting with `/` is thrown away.

**Passwords are a PBKDF2 hash with a per-user salt**, through `crypto.subtle`,
which every runtime here has. The rounds are low so the tests are quick; real
work starts around 600,000, and a real app reaches for a library.

## Tests

```sh
npm run build && npm test
```
