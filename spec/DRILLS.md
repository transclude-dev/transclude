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
