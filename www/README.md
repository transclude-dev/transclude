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

## Fonts

Three families, in `app/public/fonts/`, served from this app rather than a CDN.

- **Inter** for the interface. One variable file.
- **Noto Serif** for headings and prose. One variable file.
- **IBM Plex Mono** for the logo and code. Two static weights, because Plex Mono
  has no variable release.

Latin subsets, 112 KB in total.
