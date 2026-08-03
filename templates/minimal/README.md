# __NAME__

```sh
npm install
npm run dev
```

A page is an `.html` file in `app/routes/`. The directory tree is the route
table, so `app/routes/about.html` answers `/about`. `_layout.html` wraps every
page beside it and below.

| | |
| --- | --- |
| `npm run dev` | the dev server, with hot reload |
| `npm run check` | types, from the shapes your loaders return |
| `npm run preview` | build, then serve the build |
| `npm run build` | write `dist/` |

`dist/static` is self-contained: any static host will serve it. Everything that
reads a request is served by `npm start`.
