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
