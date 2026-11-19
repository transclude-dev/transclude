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

CI runs it in the `spec` job. The site's deploy waits for that job, and a
release runs the spec right after `npm test`.

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
  matches `/assets/index-AAAAAAAA.js`, in a body and in a header. The hash
  changes with any edit to the file behind it. Which asset a page names still
  counts.

A request may name a built asset by its hash placeholder:
`GET /assets/global-[hash].css`. The runner finds the real name in a body an
earlier entry in the case was sent, the way a browser follows a link the page
gave it. An entry fails when no earlier answer names the asset.

A header value of `[etag]` sends the `ETag` of the answer just before it,
the way a browser revalidates: `"send": { "headers": { "if-none-match":
"[etag]" } }`. A public file's validator comes from its mtime, which changes
with every build, so a case cannot write it out.

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

A case about a warning expects the build to succeed and say something:

```json
[{ "build": "warns", "diagnostic": "expected/warnings.txt" }]
```

The warnings are the lines the build prints with `[transclude]` in front.
They must be the file exactly, all of them, so a case can also show that a
warning stays quiet. The other entries in the case then run as requests.

An entry with `"log": "expected/<name>.log"` checks what the server printed to
`console.error` or `console.warn` while it answered that request. The log
must contain the file, which stops before the first stack frame. A `null`
in an entry's `headers` says the header must be absent.

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

## Invariants

An invariant holds for every app. Each case process runs them all once the
case's entries are asked, so every case that builds counts:

- **fragment equivalence.** For each page the case asked about, and each id
  the case marks `fragment`, `?fragment=<id>` answers the page's copy of that
  element. The page's copy loses its declarative shadow roots first: a shadow
  element arrives bare in a fragment, as `/docs/elements` says.
- **unknown fragment.** `?fragment=` with a name the case does not mark
  answers 404: an id the page has without the attribute, a name every object
  inherits, and names fast-check generates.
- **determinism.** Each GET, sent twice more as it went, answers the same
  status, headers and body.
- **light DOM by default.** In every HTML answer, a declarative shadow root
  on a custom element sits only on one whose source says
  `export const shadow = true`.
- **no client JavaScript unless asked for.** A case whose source has no
  script the browser runs, no element that exports more than `properties`,
  and no `watchElements` gets no such script and no `.js` URL in any HTML
  answer or `Link` header.
- **bind and update.** Each element the case defines is compiled through
  `@transclude/core/compiler`, and fast-check generates pairs of props from
  its defaults. Render the first, `bind`, `update` to the second: the tree must
  serialize the same as a full render of the second. The tree is parse5's,
  through `spec/runner/dom.js`, so nothing here needs a browser.

`spec/invariants/` holds one module per invariant, and the module says what it
checks and what it puts aside. Each one is a result in the run, written
`invariant: determinism`.

A case that is about the very thing an invariant forbids holds an
`invariants.json`, naming the invariant and saying why:

```json
{ "determinism": "The loader counts its runs, and the page prints the count." }
```

The run lets that invariant fail there, and fails it once it passes, the way
it reads a `todo`. The count prints them apart: a `todo` is a gap to close, and
an exemption stays.

Two rules need an app built for them: a page that renders whatever string it
is sent, or a list of whatever length. Each such app is a case that holds a
`property.js`, which exports a `name` and a `check` the way an invariant does,
and runs only in that case, after the invariants:

- **escaping**, in `security/escaping-generated`. Values fast-check generates
  from hostile pieces go through `${}` in text, a `<pre>`, a `<textarea>`,
  attribute values quoted three ways and an `each`. Each must read back as
  itself, and the page must have the same elements and attributes it has for
  a plain `x`.
- **loop count**, in `routing/each-count-generated`. Generated rows of cells,
  nested `each`. Every row and cell renders once, in order, with its index.
  Empty lists and lists of one are asked first, every run.

A failure names the smallest input fast-check found and the seed that replays
the run.

## Budgets

`spec/budgets.json` holds limits that are tests. Each sits a little above what
the code measured when it was set, the way the coverage floor sits under
today's coverage, so ordinary drift stays under it and a real loss goes over.

| Budget | What is measured | When |
| --- | --- | --- |
| `clientBytes` | Every `.js` file a case's build writes to `dist/client`, in bytes as built. A case the file does not name has a budget of 0 | every case |
| `renderMs` | The median of 101 renders of a named request, after 20 not timed | the cases named |
| `packedBytes` | What `npm pack` would publish, compressed | a full run |
| `wwwBuildSeconds` | `npm run build --prefix www`, start to end | a full run |

Each is a result in the run, written `budget: client JavaScript`, and carries
what it measured, so `spec/report/last.json` shows how close each one is. The
two package budgets run only when no filter is given, and the `www` one needs
`npm ci --prefix www`. `--no-package-budgets` leaves them out, which is how
`spec:runtimes` and `spec:browser` run the spec before their own checks.

A change that should cost more raises its limit in the same commit, and the
commit says why.

## Every runtime

```sh
npm run spec:runtimes                       # every case, on all four
npm run spec:runtimes -- fragments          # one area
npm run spec:runtimes -- --runtimes node,bun
```

It runs `npm run spec` first, which builds each case. Then each case that
built is served on Node, Bun, Deno and workerd in turn, from its build
directory and on one port, and its `expect.json` is replayed over HTTP by the
same client the in-process run uses. Every runtime must answer what Node
answered: the same status, the same headers, the same bytes. CI runs it in
the `runtimes` job.

What is put aside, each in `spec/runtimes/index.js` with its reason:

- `date`, `connection`, `keep-alive`, `transfer-encoding` and
  `content-length`, which each listener writes for the connection.
- The spelling of a `content-type`: case, the space after `;`, and a
  `charset` on `application/json`.
- A request whose method is not one of the seven every listener hands to the
  app. Node's parser answers 400 to one, before the app sees it.
- A case that reads a fake upstream, because the fake lives in a Node process.

A case whose rule is a runtime's to decide holds a `runtimes.json` naming the
runtime and saying why, and is not served there:

```json
{ "workerd": "Its data module reads and writes a file with node:fs, and a worker has no disk." }
```

## In a browser

```sh
npm run spec:browser                    # every case that needs Chrome
npm run spec:browser -- elements        # one area
npm run spec:browser -- --snapshot      # write the DOM files a case lacks
```

It runs `npm run spec` first, then serves each case that built on Node and
opens it in headless Chrome, driven over the DevTools protocol with no
dependency. CI runs it in the `browser` job. Two kinds of check:

- **Connecting changes nothing.** Every case that defines an element: each
  page its `expect.json` asks for with a 200 loads with no exception, no
  `console.error` and no failed load, and the body after the elements connect,
  shadow roots written out, is the body the server sent.
- **A `browser.json`.** Beside `expect.json`, a list of entries, each in a
  fresh tab:

```json
[
  {
    "name": "a shadow element re-renders on an attribute change",
    "load": "/",
    "steps": [
      { "run": "document.querySelector('user-card').setAttribute('name', 'Grace')" },
      { "expect": "document.querySelector('user-card').shadowRoot.querySelector('h3').textContent", "equals": "Grace" },
      { "dom": "user-card", "file": "expected/renamed.html" }
    ]
  }
]
```

A `run` is awaited, and then the page settles: two frames and a task, which is
after a re-render and after a style. An `expect` compares the value as JSON. A
`dom` serializes the element with its shadow roots and compares it the way a
body is compared. An exception or a `console.error` fails the entry.

## Mutations

```sh
node scripts/mutate.js src/document.js                 # against every case
node scripts/mutate.js src/document.js routing forms   # against two areas
node scripts/mutate.js src/document.js --only 12-40    # part of the list
```

It makes one small change to a module at a time, with acorn: a comparison or
a logical operator flipped, a condition negated, a statement dropped, a string
changed, a boolean flipped. It runs the spec after each, and a change that
leaves every case passing survives. A survivor is a missing case or a branch
nothing reaches. The run goes to `spec/report/mutations.json`, and the module
is written back after each change and on Ctrl-C.

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
commit, prefixed `spec:`, and Joe reviews it. Two things hold that:

- `scripts/protect-spec.js` runs before every Write and Edit an agent makes,
  from `.claude/settings.json`. It refuses one to an existing expected file or
  `expect.json`, and says why, unless `SPEC_EDIT=1` is set. A new case's files
  do not exist yet and pass.
- `scripts/spec-commits.js` fails when one commit changes both `src/` and
  expected output. The `contract` job runs it over a pull request and over a
  push to `main`.

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
