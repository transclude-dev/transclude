# Elements

An `.html` file in `app/elements/` becomes a custom element. The file name is
the tag name and it needs a dash.

## One block

Everything an element declares lives in `<script element>`, and it is a real
module: named exports the compiler reads, and whatever else the author wrote
left exactly where they wrote it.

| Export | What it is |
| --- | --- |
| `properties` | defaults, and the type each one implies |
| `state` | data the element owns, which the document cannot read |
| `prototype` | members, shared by every element of the tag |
| `attributes` | a `from`/`to` converter per prop |
| `shadow` | `true` for a shadow root. A literal |
| `formAssociated` | `true` to be a real form field. A literal |

A file has one of these blocks. A second is refused, and so is a bare `<script>`,
because an element's per-element code is a member rather than a loose body.

## Light DOM, the default

No shadow root, no boundary. Page CSS reaches it, `<label for>` works, and no
JavaScript is shipped.

```html
<!-- app/elements/site-note.html -->
<script element>
  export const properties = { tone: 'neutral' };
</script>

<style>
  :scope {
    display: block;
    border-left: 3px solid var(--rule);
    padding: 0.5rem 0.9rem;
  }
  :scope[tone='warn'] {
    border-color: #b4232c;
  }
</style>

<p><slot>Nothing to say.</slot></p>
```

```html
<site-note tone="warn">Rendered into the page's own DOM.</site-note>
```

`:scope` styles the element itself. Those rules are hoisted into `<head>` and
lose to page CSS of equal specificity, so a page can override an element it did
not write.

## Shadow root, opt-in

```html
<!-- app/elements/user-card.html -->
<script element>
  export const properties = {
    name: '',
    tags: [],
  };

  export const shadow = true;
</script>

<style>
  h3 {
    margin: 0;
  }
</style>

<h3>${name}</h3>
<ul>
  <li each="tag of tags">${tag}</li>
</ul>
<slot></slot>
```

Reach for a shadow root when the element has to seal its styles and DOM off from
the page, or re-render on its own. Otherwise stay light: it is cheaper, and it
renders the same way whether the browser asked for a whole page or one fragment.

## Props

`export const properties` declares them, with defaults that set the type. An
attribute is the value.

```html
<user-card name="Ada Lovelace" tags='["math", "engines"]'></user-card>
```

An object or an array serializes as JSON, so the browser reads the same data
back off the element that the server had.

`false`, `null` and `undefined` drop an attribute rather than writing
`class="false"`. `true` writes the name bare.

## State

`export const state` is data the element owns. Nothing observes it: assigning to
it schedules the render, the way an attribute change does for a prop.

```html
<!-- app/elements/tally-box.html -->
<script element>
  export const properties = { label: 'tally' };
  export const state = { n: 0 };

  export const prototype = {
    bump(by = 1) {
      this.n += by;
    },

    connected({ signal }) {
      this.addEventListener('click', () => this.bump(), { signal });
    },
  };
</script>

<output>${n}</output>
<span>${label}</span>
```

```html
<tally-box label="clicks"></tally-box>
<script type="module">
  const box = document.querySelector('tally-box');
  box.n = 10; // schedules a re-render
  box.bump(); // 11
  await box.updateComplete;
</script>
```

## Styling on state

A boolean state field is reflected as a custom state, so CSS can select it. No
attribute is written and no class is added, which is the point: the document
still cannot read the state, and a stylesheet still reacts to it.

```html
<script element>
  export const state = { hot: false };
</script>

<style>
  :scope:state(hot) output {
    color: #b4232c;
  }
</style>

<output>${n}</output>
```

Booleans only. A custom state is a name and not a value, so a number or a string
has nothing to select on. The state lands with the render rather than with the
assignment, so `await element.updateComplete` before asserting on it.

Nothing is reflected on the server. A state field starts at the default the
block declares, so the first paint is that default either way.

## Behavior

`export const prototype` is the element's own code. Its members land on the
class prototype, shared by every element of the tag, and `this` is the element
in all of them.

```js
export const prototype = {
  dismiss() {
    this.hidden = true;
    this.dispatchEvent(new CustomEvent('dismiss', { bubbles: true }));
  },
};
```

Three of those names belong to the framework, which calls them:

- **`connected({ signal })`** runs on every connect. Not only the first: moving
  an element in the document disconnects and reconnects it, and behavior torn
  down on the way out has to come back on the way in.
- **`disconnected()`** runs on every disconnect, so the two pair off.
- **`updated()`** runs after every render, and once on connect.

```js
export const prototype = {
  connected({ signal }) {
    this.addEventListener('click', () => this.dismiss(), { signal });
    this.chart = draw(this);
  },

  disconnected() {
    this.chart.destroy();
  },
};
```

## Three ways to undo something

Most cleanup needs none of them. A listener given `signal` is removed when the
element leaves, and that covers nearly every element here.

For the rest, pick by where the thing being undone is:

| It is | Undo it with |
| --- | --- |
| A listener | `{ signal }`, and write nothing |
| A local in `connected` | a function returned from `connected` |
| Reachable from `this` | `disconnected()` |

```js
export const prototype = {
  connected() {
    const timer = setInterval(() => this.poll(), 1000);
    return () => clearInterval(timer);
  },
};
```

The returned function runs first, then `disconnected()`, so the element's own
hook sees the connection already undone. An `async connected` is the exception:
its cleanup is a promise, so it lands after everything synchronous.

`signal` is an `AbortSignal` that fires when the element disconnects. **Always
pass it to a listener on `document`, `window` or `globalThis`.** One on the
element itself is collected with it. One on `document` holds its closure
forever, and every element after it adds another.

```js
export const prototype = {
  connected({ signal }) {
    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Escape') this.dismiss();
      },
      { signal },
    );
  },
};
```

`this.shadowRoot` is the shadow root when the element has one, and
`this.internals` is its `ElementInternals`. Both are on the element already, so
neither is passed in.

## Form association

```html
<!-- app/elements/tag-picker.html -->
<script element>
  export const properties = {
    name: '',
    value: '',
  };

  export const formAssociated = true;
</script>

<button type="button">${value || 'Pick tags'}</button>
```

```html
<form method="post">
  <input name="text" />
  <tag-picker name="tags"></tag-picker>
  <button type="submit">Add</button>
</form>
```

The element is then a real form field: it submits, resets and validates with the
rest of them.

### Saying it is invalid

`this.internals` is the handle the platform hands out, so `setValidity` works the
way it does on an input. `:invalid` matches, a submit is blocked, and the browser
shows its own message.

```html
<script element>
  export const prototype = {
    updated() {
      const empty = !this.value;
      this.internals.setValidity(
        empty ? { valueMissing: true } : {},
        empty ? 'Pick at least one tag.' : '',
        this,
      );
    },
  };
</script>
```

Call it whenever the value changes, and pass no arguments to clear it. A field
that cannot say it is wrong is not really a field, and this is the part most
custom controls leave out.

## An icon element

The framework compiles `app/icons/` into one `/icons.svg` and defines no element
for it. `npm create @transclude` writes this file into a new project, so it is
already there and it belongs to the project. Reproduced here for a project that
predates it, or one that deleted it.

```html
<script element>
  export const properties = {
    library: 'icons',
    name: '',
    label: '',
  };
</script>

<style>
  :scope {
    display: inline-flex;
    vertical-align: -0.125em;
  }
  svg {
    width: 1em;
    height: 1em;
  }
</style>

<svg if="label" role="img" aria-label="${label}"><use href="/${library}.svg#${name}"></use></svg>
<svg else aria-hidden="true"><use href="/${library}.svg#${name}"></use></svg>
```

`library` is the directory in `app/icons/`, and `icons` is the files loose at the
top. `<svg-icon library="lucide" name="check">` draws
`app/icons/lucide/check.svg`.

`<svg-icon name="check">` is decorative and hidden from a screen reader, which is
right when the icon sits beside its own label. `<svg-icon name="check"
label="Mark as done">` is announced, which is what a control holding nothing but
an icon needs. Do not pass a label for a decorative icon: `aria-hidden` and a
label together leave a screen reader nothing to say.

Set no `fill` or `stroke` here. Each symbol carries what its own file declared,
and an attribute on the symbol beats a value inherited from the element, so
setting them wins for some icon sets and loses for others. `1em` and
`currentColor` put size and color under the surrounding text instead.

Put a space between text and an icon with a `gap`, not a text node. A space is
underlined by a link and the icon is not, which reads as a typo.

## Traps

**A light element cannot `if` or `each` over a value that changes.** It does not
own its children, so it writes into the DOM it already rendered rather than
replacing it. That is a compile error naming `shadow`. A shadow element compiles
the same `each` to a block with anchors and rebuilds it.

**A shadow element in a fragment paints on connect.** A declarative shadow root
is built when a browser parses a document, and nothing that swaps HTML parses
one. A light element arrives whole.

**An element that only exports `state` still gets registered.** State is
behavior. Without the definition, `el.n = 1` sets a value no node hears about.
So is `formAssociated`: an element that submits a value has to exist to do it.

**`setHTMLUnsafe()`, never `innerHTML`,** when inserting markup that holds an
element. `innerHTML` leaves a nested declarative shadow root as a dead
`<template>`.
