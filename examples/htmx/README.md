# htmx

The same job as `examples/search`, driven by [htmx](https://htmx.org) instead
of a `fetch`. It exists to show one config key.

```sh
npm install
npm run dev     # http://localhost:1966
```

## `fragmentHeader`

htmx sends the id of the element it is about to swap in an `HX-Target` header.
Naming that header in `transclude.config.js`:

```js
fragmentHeader: 'HX-Target',
```

means the header alone can ask for a fragment. So `hx-get="/"` with
`hx-target="#people"` needs no `?fragment=` on the URL, and no framework client
code exists to put one there.

The query parameter still works and still wins. The two differ on purpose:

| | |
| --- | --- |
| `?fragment=nope` | **404**. Someone typed that. |
| `HX-Target: nope` | ignored. htmx sends it on every request, whole pages included. |

Naming a header adds it to `Vary`, which is why this is off by default. Widening
a cache key is a real cost for a feature an app may not use.

## A GET uses the header, a POST names it

The header is a convenience for reading. A request that *changes* something says
what it wants back:

```html
hx-post="/?fragment=people"
```

The two differ in how they fail, and that is the reason. An unknown name in the
query is a 404. An unknown name in the header is ignored, and the page answers
with a whole document, which htmx would then swap into the list.

## Everything that changes lives inside the fragment

A swap replaces one element. A count sitting outside it keeps whatever the last
whole-page render left there, so the list says four and the sentence above it
says three. The count in this app is the last row of the list for that reason.

## One handler, two callers

`ctx.fragment` is how the `POST` serves both. htmx asked for a fragment, so it
gets the fragment back; a redirect would swap a whole document into a list. A
plain form submission gets the 303, which is what stops a reload from repeating
the change.

Turn JavaScript off and every control on the page still works.

## htmx is not on a CDN here

`csp: true` gives `script-src 'self'`, so a script from anywhere else is refused
by the browser with nothing on the page to explain it. `npm run vendor` copies
htmx out of `node_modules` into `app/public/`, and `predev` and `prebuild` run
it. The copy is gitignored; the version in `package.json` is the record.

## Tests

```sh
npm run build && npm test
```
