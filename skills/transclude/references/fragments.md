# Fragments and includes

## Fragments

A fragment is a region of a page that has its own URL. Give the element an `id`
and a `fragment` attribute.

```html
<script server>
  import { people } from '../data/people.js';

  export default async ({ url }) => {
    const q = url.searchParams.get('q') ?? '';
    return { q, matches: people.filter((p) => p.name.includes(q)) };
  };
</script>

<h1>People</h1>

<input name="q" value="${q}" />

<ul id="matches" fragment>
  <li each="person of matches">${person.name}</li>
</ul>
```

That page answers three URLs.

| | |
| --- | --- |
| `GET /?q=ada` | the whole document |
| `GET /?q=ada&fragment=matches` | the `<ul>` and nothing else |
| `GET /?fragment=nope` | 404 |

The `id` is the name. The page and the fragment come from one template, so the
two always agree.

### Asking for one

A fragment is an ordinary URL. Anything that fetches HTML can use it.

```js
const res = await fetch('/?q=ada&fragment=matches');
document.getElementById('matches').setHTMLUnsafe(await res.text());
```

**This framework ships nothing that swaps a region into a page.** htmx, Turbo,
htmz or a short `fetch` does that. Do not look for a trigger attribute and do
not invent one.

htmx sends the target's id in an `HX-Target` header. Setting `fragmentHeader:
'HX-Target'` in the config makes `?fragment=` optional. The query parameter is
strict and an unknown name is a 404; a header naming an unknown region is
ignored, because clients send it on every request.

### Actions and fragments

`POST /?fragment=nope` changes nothing and returns 404. The region is checked
before the action runs. `ctx.fragment` tells a form submission from a fetch: the
first wants a redirect, the second wants markup.

### Styles for swapped-in markup

A fragment can land on a page that never rendered the elements inside it. Set
`watchElements: true` in the config and every page carries a small script that
notices a new tag, loads its definition and adds its styles once. It is off by
default.

## Includes

`<transclude src>` puts the same content in more than one place. It is resolved
on the server and leaves no trace in the output.

### Same page

```html
<div id="pricing" fragment>
  <p>Two pounds.</p>
</div>

<aside>
  <transclude src="#pricing"></transclude>
</aside>
```

Renders as:

```html
<div id="pricing">
  <p>Two pounds.</p>
</div>

<aside>
  <div>
    <p>Two pounds.</p>
  </div>
</aside>
```

The included copy drops the `id`. Two elements carrying one id is invalid, and a
swap aimed at it would find the wrong one.

### Another route

```html
<transclude src="/notes#notes">
  <p>The notes could not be read.</p>
</transclude>
```

The children are the fallback. The route is rendered in this process, not
fetched over HTTP.

### Another site

Off unless a host is allowed. Default deny.

```js
export default {
  proxy: {
    allow: ['developer.mozilla.org', '*.docs.example'],
  },
};
```

```html
<transclude src="https://developer.mozilla.org/en-US/docs/Web/HTML#reference">
  <p>The reference could not be read just now.</p>
</transclude>
```

This copies someone else's work onto your origin. Name a host only when you have
the right to republish what it holds, and read its license: a share-alike
license can put conditions on the page you put the fragment in. Nothing is
attributed for you. Write the credit yourself.

Tuning:

```js
proxy: {
  allow: ['developer.mozilla.org'],
  maxBytes: 5 * 1024 * 1024,
  timeout: 10_000,
  redirects: 5,
  maxAge: 60_000,
  sanitize: true,
  styles: 'keep',
}
```

`<base>`, `<link>` and `<style>` are stripped from foreign markup, because none
of them stops at the fragment. `styles: 'strip'` drops `style` attributes too.

## Traps

**`<transclude>` has no self-closing form.** `<transclude src="#a" />` is read
as an open tag. The children are the fallback, so the rest of the page becomes
them, silently, and the include still works.

**An interpolated `src` is a compile error.** `src="/docs/${slug}#intro"` cannot
be resolved, because the set of includes has to be known before the render that
would produce the value.

**A page including itself is refused,** and so is a chain that comes back
around.

**A route include shares the host page's cookies.** That is deliberate: it makes
the host page personal too, so one visitor's render is never served to the next.
