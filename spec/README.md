# spec

`spec/` says what Transclude does at its public boundary. `.html` files go in,
and HTTP responses come out. A module in `src/` should be rebuildable from
`spec/`, the published types and the docs.

```sh
npm run spec                             # every case
npm run spec -- fragments                # one area
npm run spec -- fragments/marked-element # one case
```

The run prints one block per failing case and a count, and writes the whole
run to `spec/report/last.json`. It exits 1 when a case fails.

`test/` is the fast loop for the code as it is, and most of it imports from
`src/`. Nothing here does. A case talks to a built app over `app.request()`,
the way an installed app is asked.

`design/harness-plan.md` is the plan this directory follows, one phase at a
time.

## A case

```
spec/cases/fragments/marked-element/
  CASE.md                 the rule in one sentence, then where it comes from
  app/routes/index.html   the app, laid out like any app's app/
  app/data/people.js
  expect.json             what to ask and what each answer must be
  expected/index.html
  expected/matches.html
```

`transclude.config.js` sits beside `app/` when a case needs a config other
than the default. Without one, the runner writes `export default {};`, so a
case with no config checks the defaults.

`expect.json` is a list. Each entry is one request:

```json
[
  { "request": "GET /?q=ada", "status": 200, "body": "expected/index.html" },
  {
    "request": "GET /?q=ada&fragment=matches",
    "status": 200,
    "headers": { "content-type": "text/html; charset=utf-8" },
    "body": "expected/matches.html"
  },
  { "request": "GET /?fragment=nope", "status": 404 }
]
```

- `status` is equal or the entry fails.
- `headers` is a subset. A case names the headers its rule is about.
- `body` is a file of expected markup. Both sides go through parse5, and each
  run of whitespace in text counts as one space. So the amount of whitespace
  between elements does not count, and whether a space is there does: a
  browser shows `<b>a</b> <i>b</i>` and `<b>a</b><i>b</i>` differently.
  Whitespace inside `pre`, `textarea`, `script` and `style` counts exactly.

A case about a refusal expects the build to fail:

```json
[{ "build": "fails", "diagnostic": "expected/diagnostic.txt" }]
```

The build must exit non-zero, and what it prints must contain the file. The
file holds the message, the file and line, and the code frame. Stack frames are
left out, because they name the framework's own files.

## Adding one

1. Make the directory under the area that matches the docs page:
   `fragments`, `routing`, `layouts` and so on.
2. Write `CASE.md`, `app/` and `expect.json`.
3. `npm run spec -- <area>/<name> --snapshot` writes each expected file the
   case lacks, from what the code answers today. It never overwrites one.
4. Read what it wrote. A snapshot records what the code does, not what it
   should do. Mark it unreviewed in `CASE.md` until Joe has read it.
5. Break the behavior in `src/` on purpose, watch the case fail, and put it
   back. Say in the commit how you broke it.

An expected file that exists is the contract. A change to one is its own
commit, prefixed `spec:`, and Joe reviews it.

## How the runner works

Each case runs in a child process of its own:

1. Copy `app/` and the config to `spec/.build/<area>/<name>/`.
2. Run the package's `transclude-build` there, found through `bin` in the
   package's `package.json`.
3. Import `@transclude/core/production` with that directory as the working
   directory, and ask it each request in `expect.json`.

A process per case because `@transclude/core/production` finds its app once,
when it is imported. A second case in the same process would be answered by
the first case's app.

The build directory sits inside this package, so the built server imports
`@transclude/core` by name and Node resolves the name to this checkout. The
runner never writes a `package.json` there. Node reads the nearest manifest to
resolve a self-reference, and a manifest in the case would be that one.

`--jobs <n>` caps how many cases run at once. The default is one per core.

## Why a build per case

The plan's first idea was one app holding every case, each under its own URL
prefix, built once. A build per case turned out fast enough, and the shared
app breaks on real things:

- `elements/` is one namespace per app. Two cases that each define `x-card`
  collide.
- Absolute URLs in a body or a `Location` header would carry the prefix, so
  every expected file would need it rewritten back.
- A root `_layout.html`, the 404 page, the error page and the sitemap are
  app-wide.

Measured on an Apple laptop with 16 cores, Node 22, with the three cases here
copied to 300:

| | |
| --- | --- |
| the three cases | 0.2 s |
| 300 cases, 16 at a time | 5.9 s |
| 300 cases, 4 at a time | 14.8 s |

The limit is 60 seconds for the whole corpus on a laptop. If a run passes it,
the shared app is the fallback, for the cases that use the default config.
