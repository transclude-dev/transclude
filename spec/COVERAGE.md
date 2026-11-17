# Coverage

Every behavior claim on a docs page, and the case that checks it. A claim with
no case says why. Sections follow `www/app/routes/docs/`, and an area is
complete when every claim on its page has a row.

The last column is the snapshot. `unreviewed` means the expected files record
what the code answered when the case was written, and Joe has not yet read
them. `reviewed` means he has. A case with no expected file of its own has
`-`.

## /docs/fragments

Complete.

| Claim | Case, or why none | Snapshot |
| --- | --- | --- |
| `GET /?q=ada` is the whole document, `&fragment=matches` the `<ul>` alone, `?fragment=nope` a 404 | `fragments/marked-element` | reviewed |
| The page and the fragment come from one template, so they agree | Phase 3, the fragment equivalence invariant | - |
| `#list` never reaches the server | Browser behavior, not the framework's | - |
| `<transclude src="/notes#list">` resolves while the page renders | The includes area | - |
| `setHTMLUnsafe` builds the shadow roots in a fragment | Needs a browser, phase 5 | - |
| `fragmentHeader: 'HX-Target'` makes `?fragment=` optional | `fragments/header-names-fragment` | reviewed |
| A header naming no fragment is ignored | `fragments/header-unknown-name-ignored` | reviewed |
| Naming a header in `fragmentHeader` adds it to `Vary` | `fragments/header-names-fragment` | reviewed |
| A cache keys on the query string | Cache behavior, not the framework's | - |
| A `No-Vary-Search` naming other parameters passes through | `fragments/no-vary-search-named` | reviewed |
| A `No-Vary-Search` hiding `?fragment=` is refused, naming the value | `fragments/no-vary-search-hides-fragment`. The 500 is checked; the message is in the log, which the runner does not read | reviewed |
| `POST /?fragment=nope` changes nothing and answers 404 | `fragments/post-unknown-name` | reviewed |
| `ctx.fragment` tells a form post from a fetch | `fragments/action-fragment` | reviewed |
| `watchElements` puts a script on every page | `fragments/watch-elements` | reviewed |
| `watchElements` is off by default | `routing/index-page`, whose page has no script | reviewed |

## /docs/routing

Complete.

| Claim | Case, or why none | Snapshot |
| --- | --- | --- |
| `routes/index.html` answers `/` with a whole document, `<title>` moved into `<head>` | `routing/index-page` | reviewed |
| `about.html` is `/about`, `people/index.html` is `/people`, `[name]` is a param, `[...path]` takes the rest, a `.js` file is an endpoint | `routing/route-table` | unreviewed |
| `routes/notes.md` is `/notes` | The markdown area | - |
| A draft is left out of the build: no route, no sitemap line, the not-found answer | `routing/draft-left-out` | unreviewed |
| The dev server serves a draft | The runner checks the build only | - |
| The build prints its drafts | Build output, which the runner does not read | - |
| A loader's default export returns the data the markup reads | `routing/route-table` | unreviewed |
| The loader block never reaches the browser | `routing/route-table` | unreviewed |
| Context: `url`, `params`, `route.path`, `fragment`, and `request`, `null` while prerendering | `routing/context-fields` | unreviewed |
| Context: `absolute` | The production area | - |
| Context: `action` | The forms area | - |
| Context: `after` | The runtimes area | - |
| Context: `cookies` | The cookies area | - |
| Context: `layout` | The layouts area | - |
| Context: `revalidateTag` | The production area | - |
| A loader returning a `Response` answers with it, unrendered | `routing/loader-response` | unreviewed |
| `ctx.response.status` sets the status | `routing/response-status` | unreviewed |
| Top-level `<title>`, `<meta>`, `<link>` move into `<head>`; a false `<link if>` is not sent | `routing/head-tags` | unreviewed |
| A `<title>` takes no directive | `diagnostics/title-takes-no-directive` | unreviewed |
| `${}` escapes, so `<script>` arrives as text; `html()` needs no import | `routing/interpolation-escapes` | unreviewed |
| Attribute values: whole or part, several; `false`, `null`, `undefined` dropped; `true` bare; objects and arrays as JSON; the rest escaped | `routing/attribute-values` | unreviewed |
| `${}` in an attribute name is a compile error | `diagnostics/interpolated-attribute-name` | unreviewed |
| `if`, `else-if`, `else`: the first true branch renders | `routing/if-chain` | unreviewed |
| Whitespace and comments keep a chain; another element ends it | `routing/if-chain`, `diagnostics/else-after-another-element` | unreviewed |
| An `else` with no `if` is a compile error | `diagnostics/else-without-if` | unreviewed |
| A directive takes an expression, not `${}` | `diagnostics/directive-takes-no-interpolation` | unreviewed |
| An expression has no assignment, arrow function, object literal or `await` | `diagnostics/directive-no-arrow-function`, the arrow function only | unreviewed |
| `each` repeats per item; a second name is the index from zero | `routing/each-index` | unreviewed |
| A loop's name reaches attributes, and inner loops read outer ones | `routing/each-nested` | unreviewed |
| An empty list renders nothing | `routing/each-empty` | unreviewed |
| `key` on a page changes nothing | `routing/key-on-page` | unreviewed |
| `key` keeps input values, focus and scroll across a reorder | Needs a browser, phase 5 | - |
| `if` and `each` on one element is refused | `diagnostics/if-and-each-on-one-element` | unreviewed |
| A chain split between `<head>` and `<body>` is refused | `diagnostics/hoisted-branch-split` | unreviewed |

## /docs/refusals

Started.

| Claim | Case, or why none | Snapshot |
| --- | --- | --- |
| `"fragment" takes no value`, refused with the file, the line and the id | `diagnostics/fragment-takes-no-value` | reviewed |
