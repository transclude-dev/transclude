# Drills

A drill deletes one module from `src/`, rebuilds it from `spec/`,
`types/api` and the docs, and compares the result with the old module and
the old tests. `design/harness-plan.md`, phase 8, has the steps.

How a drill runs here: `git archive main` into a directory outside the
repository, without the module and its test, and with a new git repository
so that no history is there to read. An agent with no memory of the work
rebuilds the module. It may read `spec/`, `types/api`, the docs and the rest
of `src/`, and not `design/internals.md` or `test/`.

## `src/no-vary-search.js`, 2026-11-19

- **Time:** about 2 minutes, in two spec runs. No case failed on the way.
- **Result:** all 305 cases pass. The old `test/no-vary-search.test.js`
  passes too, 15 of 15.
- **Size:** 225 lines against 81. The old module reads the header with three
  regular expressions. The new one splits the dictionary and reads each
  member.

Only two header values have a case: `except=()` and a `params` list that
leaves `fragment` out. The two modules agree on 31 of 38 other values and
answer these 7 differently:

| Header | Old | New | What a cache does |
| --- | --- | --- | --- |
| `params;x` | passes | refused | An older draft, which browsers shipped, reads bare `params` as "ignore every parameter", parameters or not |
| `params=?0` | refused | passes | Ignores nothing |
| `params=("fragment"), params=("a")` | refused | passes | The last member wins, so ignores `a` |
| `params=("a");x` | passes | refused | Ignores `a`: the member's parameters are ignored |
| `except` | passes | refused | Cannot read it, so ignores nothing |
| `params=(utm_source)` | passes | refused | Cannot read it, so ignores nothing |
| `params=("a")x` | passes | refused | Cannot read it, so ignores nothing |

`types/api/no-vary-search.d.ts` says a value naming `params` or `except` in
a shape the module cannot read counts as hiding. The last three rows are
that rule. The old module breaks it, and the cost is nothing, because a cache
ignores nothing for a header it cannot read.

The first row is a real miss in the old module: a header that a shipped
browser reads as hiding `?fragment=` goes out without an error. The second
and third rows refuse a header that hides nothing. The fourth is the new
module's own mistake.

- **What `spec/` missed:** the shapes of the header that no case covers.
- **Decided:** refuse rows 1 and 5 to 7, and pass rows 2 to 4. Neither module
  gave all seven answers.
- **The fix:** the rebuilt module, with its fourth row corrected, replaced the
  old one. Two tests in `test/no-vary-search.test.js` hold the same rows.
- **Cases added:** `fragments/no-vary-search-shapes`, one entry per row. The
  old module fails six of them, and the rebuilt one as it came back fails
  the fourth.

## `src/negotiate.js`, 2026-11-19

- **Time:** about 2 minutes, then a stop. No case could run in the copy:
  `spec/invariants/bind-update.js` imports `test/dom.js`, and the copy has no
  `test/`. With `test/dom.js` put back, the module passed on the first run.
- **Result:** all 315 cases pass. The old tests that reach the module,
  `test/serve.test.js` and `test/portable.test.js`, pass too, 84 of 84.
- **Size:** 169 lines against 95. The new one has no parse cache, which the
  old one keeps because negotiation was the largest piece of our own code in a
  profile of the request path.

`production/encodings` is the one case, with four headers: none, `gzip`,
`br`, and `br` with `If-None-Match`. On 39 other values the two modules agree
28 times and answer these 11 differently:

| Header | Old | New | What HTTP says |
| --- | --- | --- | --- |
| `br;Q=0` | `br` | none | A parameter name is case-insensitive, so this refuses `br` |
| `identity;Q=0`, to `identityAcceptable` | `true` | `false` | The same |
| `x-gzip` | none | `gzip` | A recipient should read `x-gzip` as `gzip` |
| `gzip;q=0.5, identity` | `gzip` | none | Either is allowed. The client prefers no encoding |
| `identity, br;q=0.5` | `br` | none | The same |
| `br;q=1.5, gzip` | `br` | `gzip` | A weight above 1 is not a weight |
| `br;q=0.5x, gzip;q=0.4` | `br` | `gzip` | Nor is `0.5x` |
| `br;q=.5, gzip;q=0.4` | `br` | `gzip` | Nor is `.5`: the grammar wants `0.5` |
| `gzip;q=0, gzip` | `gzip` | none | Not said. The old module keeps the last, the new one the first |
| `gzip, gzip;q=0` | none | `gzip` | The same |
| `pickEncoding('gzip')`, no list | none | `gzip` | Not HTTP. The new default is `['br', 'gzip']`, the old one `[]` |

The first two rows are a real miss in the old module: a client that refused
brotli with `Q=0` is sent brotli. The type's own comment says that must never
happen.

- **What `spec/` missed:** every rule in the type's comment, "q-values, `*`,
  and `q=0` as a refusal", has no case. And `spec/` imports from `test/`,
  which `test/spec-boundary.test.js` does not check.
- **Decided:** a parameter name ignores case, `x-gzip` is `gzip`, a client
  that weighs no encoding highest gets none, a bad weight is a refusal, and a
  coding named twice keeps the lower weight. The default list stays `[]`.
- **The fix:** the old module, patched, because it keeps the parse cache.
  Five tests in `test/serve.test.js` hold the rows, and all five fail on the
  old module. `test/dom.js` moved to `spec/runner/dom.js`, and
  `test/spec-boundary.test.js` refuses an import from `test/`.
- **Cases added:** `production/encoding-weights`, 11 entries. The old module
  fails 9 of them. The module as the drill rebuilt it fails the entry for
  `gzip, gzip;q=0`, the one row where neither module had the answer.

## `src/sitemap.js`, 2026-11-19

- **Time:** about 3 minutes, in two spec runs. No case failed on the way.
- **Result:** all 316 cases pass. The old `test/sitemap.test.js` passes 15
  of 16. The one that fails says a `Date` is written as a day.
- **Size:** 285 lines against 165. The new one checks `entries` and `limit`,
  and joins the hostname as a string, the way `src/feed.js` does.

The sitemap has eleven cases. They use one hostname with no path, string
`lastmod` values that are already days, and at most five URLs. On 32 other
inputs the two modules agree 7 times and answer these 25 differently,
grouped here by rule:

| Input | Old | New |
| --- | --- | --- |
| `lastmod` a `Date`, a number, or `2026-07-31T23:30:00-05:00` | the day in UTC, `2026-08-01` for the last | the full ISO time, or the string as written |
| `lastmod: 'yesterday'` | dropped | `<lastmod>yesterday</lastmod>` |
| `lastmod: 0` | dropped | `1970-01-01T00:00:00.000Z` |
| `priority: null` | `<priority>null</priority>` | dropped |
| a `paths()` value `a b` or `café` | `/p/a%20b`, `/p/caf%C3%A9` | `/p/a b`, `/p/café` |
| `paths()` returns `null` | no URLs | throws "not iterable" |
| `entries` returns `null` | no URLs | throws |
| an entry with no `path` | `https://x.com/undefined` | throws |
| an entry with `path: 'press'` | `https://x.com/press` | throws |
| an entry with `path: 'https://evil.com/x'` | listed on the other host | throws |
| `exclude: [/^\/a\//g]` on `/a/1`, `/a/2`, `/a/3` | keeps `/a/2` | keeps none |
| `limit: 0` | throws "Invalid array length" | throws a message that names `limit` |
| `limit: 100000` or `limit: 1.5` | accepted | throws |
| `hostname: 'https://x.com/blog'` | `https://x.com/a`, the path dropped | `https://x.com/blog/a` |
| `hostname: 'x.com'` | throws "Invalid URL" | `<loc>x.com/a</loc>` |
| `?p=5` under the cap | every URL | no URLs |
| `?p=0.5` over the cap | a slice that starts half a sheet in | no URLs |

Both modules answer a sheet past the last one, `?p=-1` and `?p=abc` with an
empty `<urlset>` and status 200.

Three rows are a real miss in the old module. A `g` flag on an `exclude`
pattern leaves every second match in, because `RegExp.test` keeps its place
between calls. An entry with no path is listed as `/undefined`. And
`priority: null` writes `null`. The new module's own misses are the raw
space and `é` in a `<loc>`, which the protocol says must be escaped, and the
`null` from `paths()`, which `bin/build.js` reads as an empty list.

The drill found three things outside the module:

- `bin/dev.js` gives the sitemap no `gated` list, so in dev it lists paths
  that production leaves out.
- The dev `/sitemap.xml` route has no `try`, so a failing `paths()` goes to
  Hono's default handler, not to `onError`.
- Past `limit`, `bin/build.js` writes only the index to
  `dist/static/sitemap.xml`. The index points at `/sitemap.xml?p=0`, which a
  static host answers with the same index.

- **What `spec/` missed:** no case has a `lastmod` that is not a day, a
  parameter value that needs escaping, a bad entry, a `limit` out of range, a
  `g` flag, or a hostname with a path.
- **Decided:** a `lastmod` is the day in UTC, and one that is no date, or
  `0`, is dropped. `priority: null` is dropped. A `<loc>` is percent-encoded.
  `null` from `paths()` or `entries` is no URLs. An entry whose path does not
  begin with one `/` is refused, and so are a `limit` outside 1 to 50000 and a
  hostname that is not an origin. A `g` flag excludes every match. Past
  `limit`, each sheet is a file at `/sitemap-0.xml` and on, and a sheet the
  index does not name is a 404. The dev server reads `gated` and reports a
  failure to `onError`.
- **The fix:** the old module, patched, with `sitemapFiles` for the sheets.
  The build writes every file it returns, and the server and the dev server
  answer the same paths. In `test/sitemap.test.js`, eight tests hold the
  rows, two hold the sheets, and one reads `bin/dev.js`. The old module fails
  both sheet tests and the five rows where its answer lost. The old
  `bin/dev.js` fails the last.
- **Cases added:** `feeds/sitemap-values`, and `diagnostics/sitemap-entry-path`,
  `diagnostics/sitemap-limit` and `diagnostics/sitemap-hostname`.
  `feeds/sitemap-index` asks for the sheet files, a sheet past the last, and
  `?p=`. Each of nine old behaviors, put back one at a time in the fixed
  module, fails its case. The old and rebuilt modules cannot be run against
  the cases whole, because neither exports `sitemapFiles`, which the build
  imports.

## `src/include.js`, 2026-11-19

- **Time:** about 3 minutes, in three spec runs. No case failed on the way.
- **Result:** all 320 cases pass. The old tests that reach the module,
  `test/include.test.js`, `test/route-include.test.js` and
  `test/portable.test.js`, pass too, 82 of 82.
- **Size:** 124 lines against 102. The new one checks a region before it
  runs the route's loaders, and has a second check for a loop.

The module is glue between `resolveIncludes` in `src/document.js` and a
route's loaders, and the cases cover it well. A diff by table does not work
here, because each input needs a compiled app, so five small apps were run
against both modules. They agree on a query in the path. They answer these
four differently:

| Input | Old | New |
| --- | --- | --- |
| `/` includes `/y#a`, `/y` includes `/z#c`, and `/z` includes `/y#d` | no answer: the request waits on itself | 500, "includes itself: /y#a includes /z#c includes /y#d" |
| `<transclude src="/notes/#notes">` | the fallback | the region from `/notes` |
| `proxy: { allow: [] }` and an include of another site | 500, "example.com is not an allowed host" | 500, "no host is allowed to be read. Name one in `proxy.allow`" |
| `/me#nope`, where `/me` has no `nope` and its loader reads a cookie | the fallback, `Cache-Control: private, no-cache` | the fallback, public |

The first row is a real miss in the old module. Loading a route resolves
every include on it, not only those in the region asked for. So `/y`
loading reaches `/y` again under a different `#id`. `resolveIncludes` checks
the chain by `src`, which is different, and the memo hands back the promise
that is still waiting. Nothing throws. In the runner the case process ends
with "unsettled top-level await". On a server the request stays open.

The new module's check misses a second shape of the same loop. When a page
includes `/y` and `/z`, and each includes the other, the two loads start at
once. Each finds the other's promise in the memo, and neither chain repeats.
Both modules wait forever on this one. The new check also cuts the query off,
so it calls `/y?x=1#a` reaching `/y?x=2#b` a loop. Those are two loads, but
`/y` includes the same things on every request, so the chain repeats one
step later anyway.

- **What `spec/` missed:** a loop through two routes, a path with a
  trailing slash, an empty `proxy.allow`, and an include of a region a route
  does not have.
- **Decided:** refuse a loop of loads, entered from one end or from both. Match
  the path as a request would be. Treat an empty `allow` as no `proxy`. Refuse
  an include of a fragment the route does not have, before its loaders run.
- **The fix:** the old module, patched. Each include records an edge from the
  load it runs inside to the load it asks for, per request, and the edge that
  would close a loop is refused before anything waits on it. Six tests in
  `test/route-include.test.js` hold the rows. One of them replaces the old
  test that said a missing fragment falls back. The old module fails five.
  The sixth checks that two routes that include the same third one are no
  loop.
- **Cases added:** `includes/loop-of-loads`, `includes/trailing-slash`,
  `diagnostics/include-route-has-no-fragment` and
  `diagnostics/include-allow-empty`. The old module fails all four, and waits
  forever on the first. The rebuilt one fails the first, waiting on `/both`,
  and the third.

## `src/compiler/directives.js`, 2026-11-19

- **Time:** about 1 minute, in one spec run. No case failed.
- **Result:** all 324 cases pass, and so do all 1532 old tests.
- **Size:** 56 lines against 29. The old module is one regular expression.
  The new one splits the value at the first `of` and checks each name.

The cases use `item of list`, `item, index of list`, a dotted list, and
`${notes}`, which is refused. On 42 values the two modules agree 36 times,
including whitespace and newlines, `item,i` with no space, `of of items`, a
list that holds ` of `, destructuring (refused by both), and empty values.
They answer these 6 differently:

| `each=` | Old | New |
| --- | --- | --- |
| `café of items`, `été, i of items` | "is malformed" | parses |
| `class of items`, `let of items`, `await of items` | parses | "is malformed" |
| `item, item of items` | parses | "is malformed" |

Each value was also compiled and served with both modules. With the old
one, `class of items` renders on the server, because `codegen.js` renames
every loop variable. The type-check shim does not rename: it writes
`for (const class of __d.items)`, which TypeScript reads as a syntax error.
`item, item of items` renders the index where the page wrote `${item}`, and
nothing says why. The type-check shim agrees with it, because the index's
`const item: number` shadows the item.

The last row is a real miss in the old module. The second row is a type
check that fails on a line the author never wrote. The first row refuses a
name that JavaScript accepts.

- **What `spec/` missed:** a name that is not ASCII, a reserved word, and
  the same name twice.
- **Decided:** take the new answer on all three rows. Accept a name that is
  not ASCII. Refuse a reserved word, and refuse the same name twice, with the
  "is malformed" message an author gets now.
- **The fix:** the old module, patched. The pattern takes any identifier, and
  two checks follow it. Three tests in `test/compiler.test.js` hold the rows,
  and the old module fails all three.
- **Cases added:** `routing/each-name-not-ascii`,
  `diagnostics/each-name-reserved` and `diagnostics/each-same-name`. The old
  module fails all three. A mutant that drops one rule fails only its own case.
  The rebuilt module passes all three, and agrees with the patched one on all
  42 values.

## Second round, 2026-11-19

The phase 8 condition is a drill that finds nothing `spec/` missed. The first
round found something in each module, so all five were drilled again against
the `spec/` that came out of it. Each copy also left out `spec/DRILLS.md`,
because it records the first round's decisions. Five agents ran at the same
time, each for 2 to 4 minutes. Each rebuilt module passes all 327 cases, and
needed one to three spec runs.

Each rebuilt module was then compared with the one on `main`, value by value,
and the old `test/` was run against it.

### `src/compiler/directives.js`

102 lines against 56. The two modules agree on 166 of 166 values: the 42
from the first round, every reserved word as the item and as the index, and
six more. The old tests pass, 1535 of 1535.

- **What `spec/` missed:** nothing. This is the first clean drill.

### `src/negotiate.js`

118 lines against 126. The two agree on 53 of 55 header values. One old test
fails, because a doc comment changed the declaration file. With `available`
left out, the rebuilt `pickEncoding` uses `['br', 'gzip']` and `main` uses
none, but the one caller always passes it.

| `Accept-Encoding` | `main` | Rebuilt |
| --- | --- | --- |
| `gzip, identity`, and `gzip;q=0.5, identity;q=0.5` | gzip | unencoded |

The two weigh gzip and identity the same. RFC 9110 calls that no preference.
`production/encoding-weights` says "weighs no encoding above every coding",
which reads either way.

- **What `spec/` missed:** a tie between a coding and an identity the header
  names.
- **Decided:** a tie goes to the coding, as `main` has it. The client takes
  either, and the encoded body is smaller.
- **The fix:** none in the code. A comment in `pickEncoding` says why, and a
  test in `test/serve.test.js` holds the tie.
- **Cases added:** two entries in `production/encoding-weights`. Each fails
  when the tie goes to identity, and so does the test.

### `src/no-vary-search.js`

400 lines against 254. The rebuilt one parses all of RFC 9651. The two agree
on 55 of 64 values, and the old tests pass, 1535 of 1535.

| `No-Vary-Search` | `main` | Rebuilt |
| --- | --- | --- |
| `garbage!!`, `PARAMS`, `Params`, `Except=()` | passes | refused |
| `params=("utm"),`, with a comma at the end | passes | refused |
| `params=("a"), except=("fragment")`, `params=?0, except=("fragment")` | passes | refused |
| `params=("fr%61gment")` | passes | refused |

The IETF draft decodes each name in `params` and `except` the way a query
key is decoded (section 5.3), so a cache reads `fr%61gment` as `fragment`.
It reads a header with both `params` and `except` as no header at all
(section 5, step 5). A cache ignores a header it cannot parse.

- **What `spec/` missed:** a name written with a percent escape, `except`
  beside a `params` that is not bare, and a header that does not parse as a
  whole.
- **Decided:** refuse the last three rows, and pass the first, as `main`
  does. A header that does not parse is refused only when it names `params`
  or `except`.
- **The fix:** the old module, patched. It decodes each name, refuses
  `except` beside a `params` list or `?0`, and notes when the dictionary does
  not parse: an empty member, a key that is not lowercase, or a string or a
  list that never closes. Three tests in `test/no-vary-search.test.js` hold
  the rows, and the old module fails all three.
- **Cases added:** four entries in `fragments/no-vary-search-shapes`. The old
  module fails the three refusals. One mutant per rule fails only its own
  entry, and a mutant that refuses every header that does not parse fails
  `PARAMS`.

### `src/sitemap.js`

369 lines against 282. The two agree on 48 of 63 configs. Four old tests
fail: the declaration file, the type check of `src/`, the message for a
missing hostname, and an `entries` function that returns `null`.

| Config | `main` | Rebuilt |
| --- | --- | --- |
| `entries: () => null` or `() => undefined` | no entries | throws |
| `{ path: '/a', lastmod: '2026-01-01' }`, then `{ path: '/a', lastmod: undefined }` | no `lastmod` | `2026-01-01` |
| `hostname: 'https://u:p@x.com'` | every `loc` holds `u:p@` | refused |
| `exclude: [5]` | read as the pattern `/5/` | refused |
| an entry `/p/a%20b` | `/p/a%20b` | `/p/a%2520b` |
| `lastmod: true` | `1970-01-01` | no `lastmod` |
| `paths()` gives `{}` | "object is not iterable" | names `paths()` and the route |
| `limit: NaN` | `"limit" is null` | `"limit" is NaN` |
| no URLs | an empty line inside `<urlset>` | none |

Three other rows differ only in the words of a message.

- **What `spec/` missed:** each row above. None has a case.
- **Decided:** keep `main` on the first and fifth rows. Take the rebuilt
  answer on the rows for `undefined`, the hostname, `exclude`, `lastmod: true`,
  `paths()` and `NaN`. Leave the messages and the empty line as they are.
- **The fix:** the old module, patched, and the build. A merge skips a field
  that is `undefined`. A hostname with a user or a password is refused, and so
  is an `exclude` item that is not a string or a `RegExp`. A `lastmod` is read
  only from a string, a number or a Date. The build read `paths()` first and
  failed with "listed.map is not a function", so the build and the sitemap
  both name the file now. Tests in `test/sitemap.test.js` hold every row, and
  the old module fails the six that changed.
- **Cases added:** `feeds/sitemap-entries-null`,
  `diagnostics/sitemap-hostname-credentials`, `diagnostics/sitemap-exclude`,
  `diagnostics/sitemap-paths-not-a-list`, `diagnostics/sitemap-limit-nan`,
  and three entries in `feeds/sitemap-values`. The old modules fail every case
  for a row that changed. The rebuilt module fails the two for the rows that
  kept `main`.

### `src/include.js`

166 lines against 221. The spec passes, and so did five more runs of
`includes/loop-of-loads`. Two old tests fail. Both expect `resolve` to be
`null`, and the rebuilt one gives `undefined`. A probe case compared the two
on a page that includes `/count#c` directly and also through `/mid#m`:

| | `main` | Rebuilt |
| --- | --- | --- |
| `/count`'s loaders, for one request | run once | run twice: the memo is keyed by the chain of loads |
| `ctx.fragment` in the included loader | `null` | `c` |

The docs say "One route included twice runs its loaders once." The rebuilt
module keys the memo by the chain so that two routes that include each other
do not wait on each other. `main` does that with the graph of loads instead.

- **What `spec/` missed:** a route included again from inside another
  include, and what the included loader reads as `ctx.fragment`.
