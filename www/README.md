# transclude docs

The documentation site. `transclude` is a dependency, from `file:..`, so this is
an ordinary app that happens to sit in the framework's repository.

```sh
npm install
npm run dev       # http://localhost:1980
npm run check     # tsc over every route
npm run preview   # build, then serve dist/ on 1980
```

Every page is one `.html` file in `app/routes/`. The nav is one array in
`app/routes/_layout.html`, so adding a page is a file and a line.

`fragmentParam` is `fragment` here, and the landing page uses it: the box saying
you are reading a fragment answers on `/?fragment=demo`, which is why this site
runs a server rather than sitting on a static host. Nothing swaps one into a
page, though. Reading the URL is the demonstration.

## Type

Three stacks from [Modern Font Stacks](https://modernfontstacks.com/), named in
`app/styles/global.css`. No `@font-face`, no font file, nothing to download.

- **Neo-grotesque** for the interface. It begins with Inter, so a reader who has
  Inter installed sees what this site used to send.
- **Transitional** for prose. Charter on a Mac, Sitka or Cambria on Windows.
- **Monospace Code** for code.

The wordmark is the exception. `app/elements/site-mark.html` draws
`#transclude` as two outlines, because the mark has to be the same shape
everywhere and the letters it is made of are IBM Plex Mono Bold.
`scripts/fonts/` keeps that file, and the one the sharing card draws with, out
of what the site serves.
