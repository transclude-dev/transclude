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
| `about.html` is `/about`, `people/index.html` is `/people`, `[name]` is a param, `[...path]` takes the rest, a `.js` file is an endpoint | `routing/route-table` | reviewed |
| `routes/notes.md` is `/notes` | The markdown area | - |
| A draft is left out of the build: no route, no sitemap line, the not-found answer | `routing/draft-left-out` | reviewed |
| The dev server serves a draft | The runner checks the build only | - |
| The build prints its drafts | Build output, which the runner does not read | - |
| A loader's default export returns the data the markup reads | `routing/route-table` | reviewed |
| The loader block never reaches the browser | `routing/route-table` | reviewed |
| Context: `url`, `params`, `route.path`, `fragment`, and `request`, `null` while prerendering | `routing/context-fields` | reviewed |
| Context: `absolute` | The production area | - |
| Context: `action` | The forms area | - |
| Context: `after` | The runtimes area | - |
| Context: `cookies` | The cookies area | - |
| Context: `layout` | The layouts area | - |
| Context: `revalidateTag` | The production area | - |
| A loader returning a `Response` answers with it, unrendered | `routing/loader-response` | reviewed |
| `ctx.response.status` sets the status | `routing/response-status` | reviewed |
| Top-level `<title>`, `<meta>`, `<link>` move into `<head>`; a false `<link if>` is not sent | `routing/head-tags` | reviewed |
| A `<title>` takes no directive | `diagnostics/title-takes-no-directive` | reviewed |
| `${}` escapes, so `<script>` arrives as text; `html()` needs no import | `routing/interpolation-escapes` | reviewed |
| Attribute values: whole or part, several; `false`, `null`, `undefined` dropped; `true` bare; objects and arrays as JSON; the rest escaped | `routing/attribute-values` | reviewed |
| `${}` in an attribute name is a compile error | `diagnostics/interpolated-attribute-name` | reviewed |
| `if`, `else-if`, `else`: the first true branch renders | `routing/if-chain` | reviewed |
| Whitespace and comments keep a chain; another element ends it | `routing/if-chain`, `diagnostics/else-after-another-element` | reviewed |
| An `else` with no `if` is a compile error | `diagnostics/else-without-if` | reviewed |
| A directive takes an expression, not `${}` | `diagnostics/directive-takes-no-interpolation` | reviewed |
| An expression has no assignment, arrow function, object literal or `await` | `diagnostics/directive-no-arrow-function`, the arrow function only | reviewed |
| `each` repeats per item; a second name is the index from zero | `routing/each-index` | reviewed |
| A loop's name reaches attributes, and inner loops read outer ones | `routing/each-nested` | reviewed |
| An empty list renders nothing | `routing/each-empty` | reviewed |
| `key` on a page changes nothing | `routing/key-on-page` | reviewed |
| `key` keeps input values, focus and scroll across a reorder | Needs a browser, phase 5 | - |
| `if` and `each` on one element is refused | `diagnostics/if-and-each-on-one-element` | reviewed |
| A chain split between `<head>` and `<body>` is refused | `diagnostics/hoisted-branch-split` | reviewed |

## /docs/layouts

Complete.

| Claim | Case, or why none | Snapshot |
| --- | --- | --- |
| `_layout.html` wraps the routes beside and below it; the page renders into `<slot>` | `layouts/wraps-page` | unreviewed |
| A named slot offers a second place, with fallback content | `layouts/named-slot` | unreviewed |
| A subdirectory layout renders inside the one above | `layouts/nested` | unreviewed |
| Each layout loads its own data; `ctx.layout` is the chain above, merged | `layouts/layout-context` | unreviewed |
| A layout returning a `Response` stops there, and nothing below runs | `layouts/guard-redirect` | unreviewed |
| A `POST` under a guard runs the guard first; each loader runs twice on that request | `layouts/guard-action` | unreviewed |
| A page behind a guard cannot be prerendered; the build names it and exits non-zero | `diagnostics/prerender-reads-cookie` | unreviewed |
| Middleware does not run during the build | A build-time fact. What middleware does when serving is the middleware area | - |
| `<html>` attributes merge by name, innermost winning; escaped, bare is `true`, `false` and `null` drop, `lang` overwritable | `layouts/html-attrs` | unreviewed |
| `<body>` works the same | `layouts/body-attrs` | unreviewed |
| Neither tag is written twice; a `class` on two levels is the innermost | `layouts/one-html-one-body` | unreviewed |
| A `<title>` anywhere in the chain becomes the document's | `layouts/title-in-chain` | unreviewed |
| A layout setting `ctx.response.status` sets the status sent | `layouts/layout-status` | unreviewed |

## /docs/refusals

Started.

| Claim | Case, or why none | Snapshot |
| --- | --- | --- |
| `"fragment" takes no value`, refused with the file, the line and the id | `diagnostics/fragment-takes-no-value` | reviewed |
