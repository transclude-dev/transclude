---
name: transclude
description: Build web apps with the transclude framework (@transclude/core), an HTML-first server-side framework on Hono. Use when working in a project that has a transclude.config.js, when writing .html pages, layouts or custom elements under app/routes/ and app/elements/, or when the user mentions transclude, fragments, transclusion, hypermedia pages, or server-rendered HTML with no client bundle.
license: MIT
metadata:
  homepage: https://transclude.dev
  package: "@transclude/core"
---

# transclude

HTML is the product. A page is an `.html` file, the server renders it, and what
arrives is markup a browser already knows how to display.

The directory tree is the route table. The same app runs on Node, Bun, Deno and
workerd.

## Start a project

```sh
npm create @transclude my-app
cd my-app
npm install
npm run dev
```

## Where files go

```
app/
  routes/          # .html is a page, .js is an endpoint
    index.html     # /
    notes.html     # /notes
    notes/[id].html    # /notes/:id
    _layout.html   # wraps every route beside and below it
    api/people.js  # /api/people
    api/_shared.js # not a route, the _ prefix says so
  elements/        # every custom element, one file each
    note-card.html # <note-card>, the name needs a dash
    svg-icon.html  # scaffolded by npm create, yours to edit
  icons/           # one SVG file per icon, compiled to /icons.svg
    check.svg      # <use href="/icons.svg#check">
    lucide/        # a subdirectory is a library: /lucide.svg
      check.svg    # <use href="/lucide.svg#check">
  public/          # copied to the site root as-is
transclude.config.js
```

## A page

```html
<script server>
  import { notes } from '../data/notes.js';

  export default async ({ url }) => {
    const q = new URL(url).searchParams.get('q') ?? '';
    return { q, notes: notes.filter((n) => n.text.includes(q)) };
  };
</script>

<title>Notes</title>

<h1>Notes</h1>

<div id="list" fragment>
  <p if="!notes.length">Nothing yet.</p>
  <ul else>
    <li each="note of notes">${note.text}</li>
  </ul>
</div>
```

The `<script server>` default export is the loader. It runs on the server and
returns the data the markup reads. Every name in `${…}` is a field of that data.

### Directives

| | |
| --- | --- |
| `${expr}` | interpolation, escaped |
| `if="expr"` | render this element only when true |
| `else` | pairs with the `if` above it |
| `each="item of items"` | repeat the element |
| `key="expr"` | identity for a repeated element |
| `fragment` | this element has its own URL, see references/fragments.md |
| `slot="name"` | fill a named slot |

`html(value)` renders markup without escaping. It is a claim that the markup is
yours. It sanitizes nothing.

Globals available in an expression: `html`, `json`, `Math`, `JSON`, `String`,
`Number`, `Boolean`, `Array`, `Object`, `Date`, `isNaN`, `parseInt`,
`parseFloat`, `undefined`, `NaN`, `Infinity`. Every other name is data.

### The loader context

`ctx` carries `url`, `request`, `params`, `cookies`, `fragment`, `response` and
`absolute()`. Returning a `Response` from a loader answers the request and skips
the render, which is how a layout does a login redirect.

## Forms and actions

A page responds to GET with its loader. Other verbs are named exports on the same
file.

```html
<script server>
  import { notes } from '../data/notes.js';

  export default async () => ({ notes: notes.all() });

  export const POST = async ({ request }) => {
    const form = await request.formData();
    notes.add(String(form.get('text')));
  };
</script>

<form method="post">
  <input name="text" required />
  <button>Add</button>
</form>

<ul id="list" fragment>
  <li each="note of notes">${note.text}</li>
</ul>
```

The action runs, then the loader renders what it left behind. `POST`, `PUT`,
`PATCH` and `DELETE` are the verbs. Return nothing to re-render, or return a
`Response` to redirect.

## Endpoints

A `.js` file in `routes/` returns a `Response`.

```js
// app/routes/api/people.js
import { people } from '../../data/people.js';

export const GET = (ctx) => Response.json(people);

export const POST = async ({ request }) => {
  const body = await request.json();
  people.push(body);
  return Response.json(body, { status: 201 });
};
```

## Layouts

`_layout.html` wraps every route in its directory and below. The page renders
into `<slot>`. Layouts nest, and each one loads its own data.

```html
<script server>
  export default async () => ({ year: 2026 });
</script>

<header><a href="/">Home</a></header>
<main><slot></slot></main>
<footer>${year}</footer>
```

## Icons

`app/icons/` holds one SVG file per icon. The build compiles them into a single
`/icons.svg` of `<symbol>`s, so a page fetches one file however many icons it
shows. The file name is the id.

```html
<svg width="16" height="16"><use href="/icons.svg#check"></use></svg>
```

A subdirectory is a library of its own, served under its name. Put a downloaded
icon set in whole and reference it by library and name:

```html
<svg width="16" height="16"><use href="/lucide.svg#check"></use></svg>
```

Every icon file needs a `viewBox`. A library is one flat directory, so a
directory inside one is refused. Two libraries may each have a `check`.

A new project has `app/elements/svg-icon.html`, which wraps the `<use>` and gets
the two aria spellings right. It is the project's file, not the framework's.

```html
<svg-icon name="check"></svg-icon>
<svg-icon library="lucide" name="check" label="Mark as done"></svg-icon>
```

Most apps wrap this in a light element so a page names an icon instead of a URL.
See [references/elements.md](references/elements.md).

## Commands

```sh
npm run dev     # dev server, hot reload
npm run build   # writes dist/, prerenders what it can
npm start       # serves the build
npm run check   # type-check every .html and .js route
```

## Traps

These are the mistakes to avoid. Each one is a real compile error or a real
bug, not a style preference.

**`${…}` inside a nested `<script>` or `<style>` is a compile error.** Text
there reaches the page as written, so a value would land in code. `json(value)`
is the one way through, and only as the entire text of the script. For a style,
pass the value through a custom property, which is an attribute and is escaped.

**A literal `${` cannot be written in a template.** There is no escape. Pass any
text containing it in from the loader as data.

**Directive values are expressions, not interpolations.** Write
`each="note of notes"`, never `each="${notes}"`.

**A `fragment` element cannot carry `if`, `else` or `each`.** A fragment is one
element with one id, so it cannot be conditional or repeated. Put the condition
on something inside it.

**A light element cannot `if` or `each` over a value that changes.** It writes
into the DOM it already rendered and never replaces a child. That is a compile
error naming `shadow`. Add `export const shadow = true` or keep the list still.

**`setHTMLUnsafe()`, never `innerHTML`.** `innerHTML` does not process nested
declarative shadow roots, so a child element becomes a dead `<template>`.

**An element file name needs a dash.** `note-card.html` is a valid custom
element name. `card.html` is not, and the file is dropped.

**`<transclude>` has no self-closing form.** `<transclude src="#a" />` is read
as an open tag and the rest of the page becomes its fallback content.

**Reading a cookie makes a page personal.** It is then not cached and not
prerendered. Writing one does not do this; reading one does.

**`ctx.response` is shared by reference.** Set `ctx.status` and headers on it
directly. It is the object the whole chain holds.

**A `<template>`'s children are not `childNodes`.** They live on `.content`.

## Going further

- [references/elements.md](references/elements.md) — custom elements, light and
  shadow, props, state, form association
- [references/fragments.md](references/fragments.md) — fragments, includes and
  transclusion
- [references/server.md](references/server.md) — cookies, middleware, security,
  config, deployment

Full documentation: https://transclude.dev/docs
