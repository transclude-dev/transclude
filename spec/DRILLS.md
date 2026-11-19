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
- **Cases added:** none yet. They wait on which answer each row should have.
