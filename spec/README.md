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
run to `spec/report/last.json`: each request, the status and headers it
answered, and every difference. It exits 1 when a case fails.

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
case with no config checks the defaults. Anything else beside `app/`, such as
a second `elementsDir`, is copied with it.

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

- `send` is optional: `{ "headers": {…}, "form": {…} }`. A `form` goes the
  way a browser posts one, form-encoded with an `origin` of
  `http://localhost`, so CSRF lets it through. `headers` apply last, and a
  `null` value takes a header away.
- `status` is equal or the entry fails.
- `headers` is a subset. A case names the headers its rule is about.
- `body` is a file of expected markup. Both sides go through parse5, and each
  run of whitespace in text counts as one space. So the amount of whitespace
  between elements does not count, and whether a space is there does: a
  browser shows `<b>a</b> <i>b</i>` and `<b>a</b><i>b</i>` differently.
  Whitespace inside `pre`, `textarea`, `script` and `style` counts exactly.
- A body file that is not `.html` compares exactly, byte for byte: a sitemap,
  a plain-text answer, JSON.
- A built asset's content hash counts as `[hash]`: `/assets/index-Cyt6b9Zw.js`
  matches `/assets/index-AAAAAAAA.js`. The hash changes with any edit to the
  file behind it. Which asset a page names still counts.

The entries in one case run in order, in one process. A POST and the GET after
it see the same app, which is how a case shows that an action ran or did not.

A case also keeps cookies, the way a browser does. A `Set-Cookie` on one answer
is sent back with every later request, and one that expires is dropped. A
`cookie` in `send.headers` replaces the jar for that request, so a case can send
a forged cookie or none.

A case about a refusal expects the build to fail:

```json
[{ "build": "fails", "diagnostic": "expected/diagnostic.txt" }]
```

The build must exit non-zero, and what it prints must contain the file. The
file holds the message, the file and line, and the code frame. It starts at
the first line naming a file under `app/`, the bundler's `[plugin …]` line, or
the error, whichever comes first, and it stops before the stack frames, which
name the framework's own files.

An entry with `"todo": "<why>"` records a known gap. The run lets it fail, and
fails it once it passes, so the mark comes off in the change that fixes it.

A case about a document on another site holds an `upstream.json`, and the
runner gives the build and the app a fake network made from it:

```json
{
  "documents": {
    "https://docs.example/guide": { "status": 200, "headers": { "etag": "\"v1\"" }, "body": "upstream/guide.html" }
  },
  "addresses": { "inside.example": "10.0.0.7" }
}
```

A listed URL answers from its entry, and a matching `If-None-Match` gets a
304. Any other URL fails the way a network that is down does. A host in
`addresses` resolves to that address, and any other host to a public one.
Nothing reaches a real site. An entry may assert the reads so far, with or
without a request: `"upstream": { "https://docs.example/guide": 1 }`, and
`"304 https://docs.example/guide"` counts the 304s. The counts are the app's,
not the build's.

`spec/runner/upstream.js` does this by replacing `fetch` and
`dns.promises.lookup` in both processes. Nothing in `src/` is touched. These
cases run on Node only.

## Adding one

1. Make the directory under the area that matches the docs page:
   `fragments`, `routing`, `layouts` and so on.
2. Write `CASE.md`, `app/` and `expect.json`.
3. `npm run spec -- <area>/<name> --snapshot` writes each expected file the
   case lacks, from what the code answers today. It never overwrites one.
4. Read what it wrote. A snapshot records what the code does, not what it
   should do. When it disagrees with the docs, stop and ask which is wrong.
5. Add the claim and the case to `COVERAGE.md`, marked `unreviewed` until Joe
   has read the snapshot.
6. Break the behavior in `src/` on purpose, watch the case fail, and put it
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
