# Verification harness: plan

A plan for Claude Code. Work it one phase per branch, one pull request per phase.
Read `CONTRIBUTING.md`, `design/internals.md` and `design/voice.md` before the
first phase.

## Goal

`spec/` is a black-box conformance suite. It says what Transclude does at its
public boundary: `.html` files go in, HTTP responses and DOM come out. It is
strong enough that a module in `src/` can be deleted and rebuilt from `spec/`,
the published types and the docs alone.

The work is done when the regeneration drills in phase 8 pass.

## Why this, when the suite is already strong

The suite is good. It has 74 test files, the bind/update rule, falsify before
trusting, a CRAP score, browser checks with a 95% coverage floor, Node 22, 24
and 26, and a smoke test on four runtimes.

It is also tied to the code it tests. 64 of the 74 test files import from
`src/`, mostly `compiler/index.js`, `document.js`, `runtime/index.js` and
`compiler/codegen.js`. A correct rewrite of the compiler fails every test that
calls `splitBlocks` or `compileFragment`. Those tests guard the current
implementation. They do not define the behavior.

The behavior is written down, in prose. The 36 docs pages already follow the
voice rule "say what it produces": "`GET /notes?fragment=list` returns the
`<ul>` and nothing else." The gotchas in `design/internals.md` record what
broke quietly. Both are test cases that nothing runs yet. This plan makes them
run.

The existing tests stay. They are the fast inner loop for the code as it is.
`spec/` is the contract for any code that replaces it.

## Decisions

1. `spec/` sits at the top level. It is a contract, not one more test file.
2. The contract is HTTP and the DOM. The `@transclude/core/compiler` export is
   not part of it, so a rewrite of the compiler may change that export.
3. A bug a case finds is fixed in the same pull request when the fix is one
   line, in its own commit. A larger fix is a separate change, and the case
   waits as `todo`.
4. `fast-check` is the one new dev dependency, added in phase 3.

## Ground rules

- **Public boundary only.** `spec/` imports from `@transclude/core` and its
  published subpaths, and talks to apps over `app.request()`. Never from
  `src/`. A test says so, the way a test already says nothing in the package
  reaches into `examples/`.
- **No behavior changes in `src/` beyond one-line fixes.** When a case shows a
  bug, fix it in its own commit if the fix is one line. Otherwise mark the
  case `todo` with a one-line note and list it in the pull request.
- **Falsify every case and every invariant.** Break the behavior on purpose,
  watch it fail, put it back. Say in the commit how you broke it.
- **Never edit expected output to make a run pass.** A change to expected
  output is its own commit, prefixed `spec:`, and Joe reviews it.
- **Node's own test runner.** No new framework. `parse5` is already a
  dependency. `fast-check` is the one new dev dependency this plan wants. Ask
  before adding any other.
- **House style.** Comments are one to three sentences. American spelling, no
  em dashes. `scripts/spelling.js` already runs after every write.

## Layout

```
spec/
  README.md              what spec/ is, how to add a case, how the runner works
  COVERAGE.md            docs claim or gotcha → case id, or the reason it has none
  DRILLS.md              one entry per regeneration drill
  budgets.json
  cases/
    fragments/
      marked-element/
        CASE.md          one sentence: the rule. Then: source (docs page or gotcha)
        app/routes/index.html
        app/elements/…   when the case needs one
        transclude.config.js    only when the case needs a non-default config
        expect.json
        expected/
          index.html
          matches.html
      unknown-name-is-404/
    routing/
    layouts/
    includes/
    elements/
    styles/
    forms/
    endpoints/
    cookies/
    security/
    markdown/
    feeds/
    diagnostics/
  invariants/
    fragment-equivalence.test.js
    determinism.test.js
    escaping.test.js
    …
  runner/
  report/                gitignored, last run as JSON
```

Areas follow the docs pages, so a reader of `/docs/fragments` knows to look in
`spec/cases/fragments/`.

`expect.json` is a list of requests and what each one answers:

```json
[
  { "request": "GET /?q=ada", "status": 200, "body": "expected/index.html" },
  { "request": "GET /?q=ada&fragment=matches", "status": 200,
    "headers": { "content-type": "text/html; charset=utf-8" },
    "body": "expected/matches.html" },
  { "request": "GET /?fragment=nope", "status": 404 }
]
```

Bodies compare after a parse5 parse and serialize, so insignificant whitespace
does not count. Headers compare as a subset. A diagnostics case expects the
build to fail and holds `expected/diagnostic.txt` with the message, file and
line.

## Phase 0: the runner

Build the smallest runner that works, and measure it.

The constraint is speed. The whole corpus runs in under 60 seconds on a laptop,
or nobody runs it.

The first idea was one generated app for every case with the default config,
each case under its own route prefix, built once. A probe showed it is not
needed: a small app builds in about 0.15 seconds, so each case builds on its
own, in parallel. The prefix idea also breaks on real things. `elements/` is
one namespace per app, absolute URLs in a body would carry the prefix, and a
root layout, the 404 page and the sitemap are app-wide. The shared app stays
the fallback if the corpus passes 60 seconds. `spec/README.md` holds the
decision and the timings.

**Done when** three cases pass: a page, a fragment and a diagnostic. Each one
fails when its behavior is broken on purpose. `npm run spec` runs them.

## Phase 1: seed the corpus from the docs

Go through every page in `www/app/routes/docs/`. List each claim about
behavior: a status, a response body, a header, an element that renders a
certain way, a refusal. Turn each claim into a case.

1. Write the case from the docs example. The voice rules say a docs example is
   complete and runnable, so most cases are the example itself.
2. Snapshot what Transclude produces today as the expected output.
3. Record the claim and the case id in `COVERAGE.md`. A claim with no case gets
   a reason: not observable at the boundary, needs a browser (phase 5),
   needs a second runtime (phase 4).

Order: fragments, routing, layouts, elements, includes, forms, endpoints,
security. Then the rest. One pull request per area keeps the review small.

The snapshots are the one step that needs Joe. A snapshot records what the
code does, not what it should do. Each expected file is marked unreviewed in
`COVERAGE.md` until he approves it. When a snapshot disagrees with the docs,
stop and ask which one is wrong.

**Done when** every claim on every docs page has a case or a written reason,
and every snapshot is reviewed.

## Phase 2: the gotchas

Sort the gotchas in `design/internals.md` into two groups.

- **Behavioral.** The failure shows at the boundary: a wrong response, a dead
  element, a missing header. Each one gets a case whose `CASE.md` names the
  gotcha. Add `spec: <case id>` at the end of the gotcha's text.
- **Internal.** About how `src/` is written: the shim being `.js`, which
  module imports TypeScript. These stay where they are.

List both groups in `COVERAGE.md`. When a gotcha is hard to sort, put it in
the list for Joe instead of guessing.

**Done when** every behavioral gotcha has a case, and each one fails with the
old bug put back in. The gotcha usually says what the bug looked like.

## Phase 3: invariants

Invariants are properties that run over every case in the corpus, plus input
from `fast-check`. One invariant checks what would take hundreds of cases to
write out.

- **Fragment equivalence.** For each element with an `id` and a `fragment`
  attribute in a full render, `?fragment=<id>` answers that element's subtree.
  The documented difference applies: a shadow element arrives bare in a
  fragment and paints on connect. Encode that difference from
  `/docs/elements`. Do not loosen the comparison until it passes.
- **Unknown fragment.** `?fragment=` with any name not in the page answers 404.
- **Determinism.** The same request twice answers the same bytes. Normalize
  only what is meant to change, such as a CSP nonce or a date. List what is
  normalized and why in the test.
- **Escaping.** Generated strings through `${}` in text, attribute values and
  `each` items come out as text. No new elements, no new attributes, no
  broken-out quotes. Use hostile strings.
- **Loop count.** `each` over 0, 1 and n items renders 0, 1 and n instances.
- **Light DOM by default.** No shadow root unless the element has
  `export const shadow = true`.
- **No client JavaScript unless asked for.** A page with no client `<script>`
  and no element that needs one ships no script tag and no JavaScript asset.
- **The bind/update rule, everywhere.** After `bind` and `update`, the DOM
  serializes to what a full render of those props produces. Today this runs in
  `test/` against chosen props. Run it over every element case with generated
  props, using `test/dom.js` or the browser runner from phase 5.

**Done when** each invariant runs over the whole corpus and each one has been
falsified.

## Phase 4: every runtime, compared

`scripts/smoke.sh` proves each runtime starts and answers two requests for
TodoMVC. Extend that idea to the corpus.

Build every case once. Serve each built case on Node, Bun, Deno and workerd
(through wrangler, which runs the real workerd). Replay every request in every
`expect.json` against all four. The normalized responses must be identical
across runtimes, not only correct on each.

Reuse the start, poll and cleanup approach from `smoke.sh`. Extend the
`runtimes` job in `ci.yml` rather than adding a parallel one.

**Done when** CI replays the whole corpus on four runtimes and fails on any
difference, and a deliberate difference (a runtime check that changes one
header) is caught.

## Phase 5: the browser

Some behavior needs a real browser: shadow boundaries, form-associated
elements, `moveBefore`, slot projection, `:scope` styles, `host` and `signal`
per instance, the signal aborting on disconnect.

`examples/showcase/scripts/browser.js` already drives Chrome through the
DevTools protocol, and `coverage.js` reads coverage back. Reuse them. Do not
add Playwright.

Add a `browser.json` beside `expect.json` for cases that need one: load this
URL, do this, expect this serialized DOM. Run the corpus app's browser cases
in the existing `browser` CI job. Keep the 95% floor.

**Done when** every element case runs in Chrome and every claim marked "needs
a browser" in phase 1 has a case.

## Phase 6: budgets

`spec/budgets.json` holds limits that are tests:

- client JavaScript bytes per case (0 for cases with no client script)
- packed size of `@transclude/core`
- build time for `www`
- render time for a few named cases, measured as a median

Set each limit a little above today's number, the way the coverage floor sits
under today's coverage. Normal drift should not trip a limit. A real loss
should.

**Done when** the budgets run in `npm run spec` and each one fails when
pushed past on purpose.

## Phase 7: the loop

The point of the harness is that an agent can run it, read the result and fix
what it says.

- **One command.** `npm run spec` prints a short summary and writes
  `spec/report/last.json`: case id, request, expected against actual as a
  diff, and any diagnostic. A failure in that file is enough context for the
  next fix.
- **CI.** A `spec` job. `deploy` needs it.
- **Protect the contract.** Add a `PreToolUse` hook to `.claude/settings.json`
  that blocks `Write` and `Edit` on `spec/cases/**/expected/**` and
  `spec/cases/**/expect.json` unless `SPEC_EDIT=1` is set. A hook that exits
  with code 2 blocks the call and shows its message to the agent. The message
  says why: "expected output is the contract; a change to it is a `spec:`
  commit Joe reviews." Also add a CI check that fails a pull request where
  one commit changes both `src/` and expected output.
- **Tell the agent.** Add a section to `CONTRIBUTING.md` and a line to
  `skills/transclude/SKILL.md`: `spec/` is the contract, a failing case means
  the code is wrong until shown otherwise.
- **The boundary test.** Fails if anything in `spec/` imports from `src/`.

**Done when** the hook blocks an edit to an expected file, the CI check fails
a mixed commit, and both have been tried.

## Phase 8: measure the harness

A harness is as good as the bugs it catches. Two ways to find out.

**Mutation testing.** `scripts/crap.js` already walks `src/` with acorn. Write
`scripts/mutate.js` the same way: apply one small change at a time to a
target module (flip a comparison, negate a condition, drop a statement, change
a string), run the matching part of `npm run spec`, and report each change
that survives. A surviving mutation is a missing case or a dead branch. Start
with `src/document.js` and `src/compiler/directives.js`. Ask before reaching
for Stryker instead.

**Regeneration drills.** This is the real test.

1. On a branch, delete one module from `src/`. Keep its declaration in
   `types/api`.
2. In a fresh Claude Code session, rebuild it from `spec/`, `types/api` and
   the docs. Not from git history, not from the old tests.
3. Run `npm run spec` until it passes.
4. Then run the old suite and diff behavior by hand. Anything the old suite
   or a person catches that `spec/` missed becomes a new case.
5. Record the drill in `DRILLS.md`: the module, how long it took, what
   `spec/` missed, the cases added.

Order, from small to large: `src/no-vary-search.js`, `src/negotiate.js`,
`src/sitemap.js`, `src/include.js`, then `src/compiler/directives.js`.

**Done when** the three leaf modules and one compiler module come back from a
drill with `spec/` passing and nothing found that `spec/` missed.

## Running this with Claude Code

- One phase per branch and pull request. Start each in plan mode with "Read
  `design/harness-plan.md`, phase N" and approve the plan before it writes.
- Phase 1 splits by area. Run areas in parallel worktrees when the runner is
  stable.
- Joe's review is the gate for snapshots, sorted gotchas and anything in
  `COVERAGE.md` marked for him. Everything else the harness checks.
