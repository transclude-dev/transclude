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

## The newsletter

An issue is a route. `app/routes/newsletter/001.html` renders the message
itself, tables and inline styles and all, so opening it in a browser shows what
a subscriber gets rather than a nicer version of it. `?format=email` is the only
difference: the unsubscribe link is the provider's token there and the signup
form here.

```sh
npm run newsletter -- 001                     # what would be sent, and nothing else
npm run newsletter -- 001 --test you@you.dev  # one copy, to one address
npm run newsletter -- 001 --audience          # the list
```

Dry run unless told otherwise. Sending is a command rather than something a
deploy can do, and `--audience` refuses an issue that the `sends` table already
records, so a retry or a second run cannot post it twice.

The subject is the issue's `<title>` and the preview line is its
`<meta name="description">`, because those already mean exactly that. The plain
text half is derived from the markup rather than written beside it, so the two
cannot drift.

`RESEND_API_KEY` lives as a worker secret and is not on this machine. A real
send needs it passed in:

```sh
RESEND_API_KEY=… npm run newsletter -- 001 --test you@you.dev
```
