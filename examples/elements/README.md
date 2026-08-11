# Elements

Light and shadow custom elements side by side, and the rule for choosing.

```sh
npm install
npm run dev     # http://localhost:1969
```

An `.html` file in `app/elements/` is a custom element. The file name is the tag
name and needs a dash. It renders into the page's own DOM unless it asks for a
shadow root, and the file says which:

```js
export const shadow = true;
```

## The three in here

**`site-note`** is light, with styles and a slot and no behaviour. It is rendered
on the server and registers no class in the browser, so a visitor downloads
nothing for it.

**`tally-box`** is light *and* interactive. It has state, a prototype method and
a click listener. Pressing it writes a new number into the text node the
compiler bound. Nothing is replaced, which is what a light element is allowed to
do.

**`person-card`** asks for the boundary. Its styles cannot leave and page CSS
cannot reach in, so its rules say `h3` and mean it. It also renders a list from
a prop, which is the line a light element cannot have.

## Which one

Stay light. Reach for the boundary when one of these is true.

| Light | Shadow |
| --- | --- |
| Page CSS styles it, which is right for content | Styles are sealed, which is right for a widget |
| `<label for>` and a form find it | A form needs `formAssociated` |
| Writes into what it rendered | Rebuilds, so `if` and `each` over changing data work |
| Arrives whole in a fragment | Arrives bare in a fragment, and paints on connect |

## The error you will meet

An `if` or an `each` over a value that changes is a compile error in a light
element, and the message names `shadow`. That is not tidiness. A light element
does not own its children: the caller's slotted markup is among them, and the
page's own script may be holding one. So it writes, and never replaces.

## What to look at in a browser

Two of the things this example is about cannot be tested in Node, because
nothing there models a shadow root. Open the page and check:

- **Click a tally.** Both boxes count separately: state belongs to an element,
  not to a tag.
- **`site-note p { font-style: italic }` in `global.css` lands.** Page CSS
  reaches a light element.
- **`person-card h3 { text-decoration: line-through }` does not.** The same
  stylesheet, stopped at the boundary.
- **In the console**, `document.querySelector('person-card').tags = ['a','b']`
  rebuilds the list. The same assignment on a light element would be refused at
  compile time.

## Tests

```sh
npm run build && npm test
```
