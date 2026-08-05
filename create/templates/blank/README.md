# __NAME__

```sh
npm install
npm run dev
```

A page is an `.html` file in `app/routes/`. The directory tree is the route
table, so `app/routes/about.html` answers `/about`.

Icons are SVG files in `app/icons/`, compiled into one `/icons.svg` the browser
fetches once. A subdirectory becomes a library of its own, so an icon set you
downloaded goes in whole. `app/elements/svg-icon.html` points at them and is
yours to change:

```html
<svg-icon name="check"></svg-icon>
<svg-icon library="lucide" name="check" label="Mark as done"></svg-icon>
```

| | |
| --- | --- |
| `npm run dev` | the dev server, with hot reload |
| `npm run check` | types, from the shapes your loaders return |
| `npm run preview` | build, then serve the build |
| `npm run build` | write `dist/` |

`dist/static` is self-contained: any static host will serve it. Everything that
reads a request is served by `npm start`.
