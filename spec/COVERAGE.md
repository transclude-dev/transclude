# Coverage

Every behavior claim on a docs page, and the case that checks it. A claim with
no case says why. Sections follow `www/app/routes/docs/`, and an area is
complete when every claim on its page has a row.

A `todo` case records a gap the docs and the code disagree on. The run lets
it fail, and fails it once it passes, so the mark comes off with the fix.

The last column is the snapshot. `unreviewed` means the expected files record
what the code answered when the case was written, and Joe has not yet read
them. `reviewed` means Joe has. A case with no expected file of its own has
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
| A `No-Vary-Search` hiding `?fragment=` is refused, naming the value | `fragments/no-vary-search-hides-fragment`, the 500 and the logged message | reviewed |
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
| `_layout.html` wraps the routes beside and below it; the page renders into `<slot>` | `layouts/wraps-page` | reviewed |
| A named slot offers a second place, with fallback content | `layouts/named-slot` | reviewed |
| A subdirectory layout renders inside the one above | `layouts/nested` | reviewed |
| Each layout loads its own data; `ctx.layout` is the chain above, merged | `layouts/layout-context` | reviewed |
| A layout returning a `Response` stops there, and nothing below runs | `layouts/guard-redirect` | reviewed |
| A `POST` under a guard runs the guard first; each loader runs twice on that request | `layouts/guard-action` | reviewed |
| A page behind a guard cannot be prerendered; the build names it and exits non-zero | `diagnostics/prerender-reads-cookie` | reviewed |
| Middleware does not run during the build | A build-time fact. What middleware does when serving is the middleware area | - |
| `<html>` attributes merge by name, innermost winning; escaped, bare is `true`, `false` and `null` drop, `lang` overwritable | `layouts/html-attrs` | reviewed |
| `<body>` works the same | `layouts/body-attrs` | reviewed |
| Neither tag is written twice; a `class` on two levels is the innermost | `layouts/one-html-one-body` | reviewed |
| A `<title>` anywhere in the chain becomes the document's | `layouts/title-in-chain` | reviewed |
| A layout setting `ctx.response.status` sets the status sent | `layouts/layout-status` | reviewed |

## /docs/elements

Complete.

| Claim | Case, or why none | Snapshot |
| --- | --- | --- |
| The file name is the tag, rendered into the page's own DOM | `elements/light-element` | reviewed |
| A tag needs a dash; a file without one stops the build | `diagnostics/element-name-needs-dash` | reviewed |
| The style block goes into `<head>` once; `:scope` is the element | `elements/light-element` | reviewed |
| `elementsDir` may name several directories, read as one set | `elements/several-dirs` | reviewed |
| The same tag in two directories stops the build, naming both | `diagnostics/element-in-two-dirs` | reviewed |
| The dev server watches every directory | The runner checks the build only | - |
| `shadow = true` gives a declarative shadow root and a real `<slot>` | `elements/shadow-element` | reviewed |
| Page CSS reaches a light element; a shadow one only through inherited properties and `::part()` | Needs a browser, phase 5 | - |
| A light element ships JavaScript only with behavior; a shadow one always | `elements/javascript-shipped` | reviewed |
| Re-render on an attribute change: light in place, shadow including structure | Needs a browser, phase 5 | - |
| A light element's slots are filled on the server, named and fallback included, and no `<slot>` is sent | `elements/light-slots` | reviewed |
| `slotchange` and `assignedNodes()` work only in a shadow element | Needs a browser, phase 5 | - |
| An `if` or `each` over a changing value in a light element is refused, naming `shadow` | `diagnostics/light-element-structural-directive` | reviewed |
| A light element of plain markup ships nothing | `elements/javascript-shipped` | reviewed |
| In a fragment, a light element arrives whole and a shadow one bare | `elements/in-a-fragment` | reviewed |
| A shadow element in a fragment paints on connect | Needs a browser, phase 5 | - |
| The server writes `referenceTarget` on the declarative shadow root | `elements/reference-target` | reviewed |
| A label, `aria-labelledby` and the like reach the target | Needs a browser, phase 5 | - |
| The target id must exist, be written out, sit outside an `each`, and the element must be shadow | `diagnostics/reference-target-missing-id`, `-bound-id`, `-in-each`, `-on-light` | reviewed |
| Chrome and Edge follow the target, Safari and Firefox do not | Browser support, not the framework's | - |
| `connected` gets a `signal` that aborts on disconnect | Needs a browser, phase 5 | - |
| A `document` listener with no `signal` is a build warning | Build output, which the runner does not read. The second claim to need it | - |
| `prototype` members; `connected`, `disconnected`, `updated`; cleanup order | Needs a browser, phase 5 | - |
| State: each element its own copy, a property per name, a re-render on set, `updateComplete` | Needs a browser, phase 5 | - |
| A name in both `properties` and `state` is a compile error | `diagnostics/prop-and-state-same-name` | reviewed |
| State renders on the server with its default, and nothing is reflected | `elements/state-default` | reviewed |
| A boolean state is a custom state CSS can select | Needs a browser, phase 5 | - |
| Objects and arrays are written as JSON in the attribute | `elements/shadow-element`, and `routing/attribute-values` | reviewed |
| `formAssociated` needs no shadow root | `elements/form-associated` | reviewed |
| Its value is submitted under its `name`; `setValidity`, `:invalid`, a blocked submit | Needs a browser, phase 5 | - |
| A disabling `<fieldset>` sets the `disabled` custom state | Needs a browser, phase 5 | - |
| `shadow` and `formAssociated` must be literals | `diagnostics/shadow-flag-not-literal` | reviewed |

## /docs/includes

Complete. The cases that read another site carry an `upstream.json`, so they
run on Node only.

| Claim | Case, or why none | Snapshot |
| --- | --- | --- |
| `#pricing` copies a fragment of this page; the copy leaves the id behind | `includes/same-page` | reviewed |
| `/notes#notes` runs that route's loaders and not its layouts' markup | `includes/another-route` | reviewed |
| A copy from another route keeps its id | `includes/another-route` | reviewed |
| One route included twice runs its loaders once | `includes/route-twice-loads-once` | reviewed |
| Reading spreads: a page including a route that reads a cookie is personal | `diagnostics/include-reads-cookie` | reviewed |
| A remote include needs `proxy.allow` and renders the section | `includes/remote-section` | reviewed |
| On success the children are dropped | `includes/remote-section` | reviewed |
| A source that cannot be read renders the children | `includes/fallback-on-failure` | reviewed |
| With no children, a failing source stops the render | `diagnostics/include-source-down-no-fallback` | reviewed |
| A host nobody allowed throws, children or not | `diagnostics/include-host-not-allowed` | reviewed |
| A prerendered page reads its sources once, at build time | `includes/prerendered-reads-once` | reviewed |
| `#nope`, `#a` inside `#a`, and an interpolated `src` are compile errors | `diagnostics/include-names-no-fragment`, `include-includes-itself`, `include-src-interpolated` | reviewed |
| A loop round other routes is caught at render, naming the way round | `diagnostics/include-cycle` | reviewed |
| A chain more than ten deep is caught | `diagnostics/include-chain-too-deep` | reviewed |
| Licensing, credit and attribution | Advice to the author, not behavior | - |
| No proxy route until a host is named | `includes/proxy-off-by-default` | reviewed |
| Extent: heading runs, `<dt>` runs, an element as itself, a bookmark one hop | `includes/extent` | reviewed |
| Ids from heading text; explicit ids win | `includes/generated-ids` | reviewed |
| A fragment is a node list, as in the source | `includes/extent` | reviewed |
| What the cleaning removes, and what it keeps | `includes/sanitize` | reviewed |
| `styles: 'strip'` drops `style` attributes | `includes/strip-styles` | reviewed |
| Relative URLs, hash-only `href`, `srcset`, `url()` and a form's `action` made absolute | `includes/urls-absolute` | reviewed |
| A custom element from the source arrives inert | `includes/sanitize` | reviewed |
| An unknown `proxy` key throws, naming every key | `diagnostics/proxy-unknown-key` | reviewed |
| Redirects followed one at a time, every hop checked; too many refused | `includes/redirects` | reviewed |
| Private ranges, the metadata endpoint and IPv4-in-IPv6 refused | `includes/private-addresses` | reviewed |
| `maxBytes` | `includes/max-bytes` | reviewed |
| `timeout`, `cache`, `cacheBytes` | Time and memory limits: phase 6, budgets | - |
| Several fragments of one page cost one read | `includes/remote-section` | reviewed |
| Past `maxAge`, revalidated with `ETag` | `includes/revalidate` | reviewed |
| On workerd there is no resolver, so only the allowlist holds | Phase 4, runtimes | - |
| The resolver is asked twice, and a record can change between | Not observable at any boundary | - |
| `/_transclude/proxy` answers a fragment, or the outline and what was removed | `includes/endpoint` | reviewed |
| The endpoint is same-origin, which the default policy requires | `security/csp-meta`: `default-src 'self'` covers `connect-src` | reviewed |

## /docs/forms

Complete.

| Claim | Case, or why none | Snapshot |
| --- | --- | --- |
| A form posts to itself; the handler runs, then the loader renders what it left | `forms/post-redirect-get` | reviewed |
| One export per method: `POST`, `PUT`, `PATCH`, `DELETE` | `forms/verbs` | reviewed |
| A `<form>` can only send GET or POST | HTML, not the framework | - |
| A hidden `intent` field turns a post into a delete | `forms/intent-field` | reviewed |
| From script, `DELETE` is sent directly and runs | `forms/verbs` | reviewed |
| Answer a mutation with a 303; a rejected submission re-renders instead | `forms/post-redirect-get` | reviewed |
| A fragment request gets markup, not the redirect | `fragments/action-fragment` | reviewed |
| `ctx.action` holds what the handler returned | `forms/post-redirect-get` | reviewed |
| `ctx.action` is typed as every handler's return type at once | Type checking, the types area | - |
| A shared module-level `Response` fails after the first request | `forms/shared-response` | reviewed |
| CSRF is on by default for non-GET requests with a form content type | `forms/csrf-default` | reviewed |
| `csrf: false` turns it off | `forms/csrf-off` | reviewed |
| An object allows another origin | `forms/csrf-allow-origin` | reviewed |

## /docs/endpoints

Complete.

| Claim | Case, or why none | Snapshot |
| --- | --- | --- |
| A `.js` file answers with the `Response` it builds: `GET` 200, `POST` 201, `PUT` 405 with `Allow` | `endpoints/json-api` | reviewed |
| One export per verb: `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS` | `endpoints/every-verb` | reviewed |
| A verb not exported answers 405 with `Allow` naming the ones that are | `endpoints/json-api` | reviewed |
| A handler returning anything but a `Response` throws and says so | `endpoints/must-return-response` | reviewed |
| A bracketed segment arrives in `ctx.params`; a resource with `GET`, `PATCH`, `DELETE` | `endpoints/resource` | reviewed |
| `[...rest].js` takes the rest; `_` files and directories are not routes | `endpoints/rest-and-helpers` | reviewed |
| The body reads as JSON, a form, text or bytes, as it was sent | `endpoints/request-body` | reviewed |
| Status and headers on the `Response`; a cookie set through `ctx.cookies` survives it | `endpoints/response-cookies` | reviewed |
| A webhook verifies its signature against the raw text | Author code. The raw body it needs is `endpoints/request-body` | - |
| CSRF guards every method but `GET` and `HEAD`; the content-type table | `endpoints/csrf-content-types` | reviewed |
| A `Response` takes a `ReadableStream` | `endpoints/stream` | reviewed |
| A stream ends on `abort` or on `cancel()` | Needs a socket that closes: phase 4, runtimes | - |
| CORS is Hono middleware in `app/server.js` | `endpoints/cors` | reviewed |
| Anything larger belongs in `app/lib/` or `app/data/` | Advice, not behavior | - |
| `transclude-check` types every handler | Type checking, the types area | - |
| `nosniff` on every response; cookies and headers survive a redirect | `endpoints/envelope` | reviewed |

## /docs/security

Complete.

| Claim | Case, or why none | Snapshot |
| --- | --- | --- |
| `csp: true` gives each page a policy built from what it inlines | `security/csp-meta`, `security/csp-per-page` | reviewed |
| Every `${}` is escaped; a visitor's markup arrives as text | `security/escaped-comment`, `routing/interpolation-escapes` | reviewed |
| `html()` writes markup you vouch for; it sanitizes nothing | `security/html-in-place`, `routing/interpolation-escapes` | reviewed |
| An escaped value cannot open or close anything; a comment ends where the file ends it | `security/html-in-place` | reviewed |
| `${}` in a `<script>` or a `<style>` in the markup is a compile error | `diagnostics/script-takes-no-expression`, `style-takes-no-expression` | reviewed |
| The same in a page's or an element's top-level `<style>` | `diagnostics/page-style-takes-no-expression`, `element-style-takes-no-expression` | reviewed |
| A top-level `<script>` is client code, and its `${}` is JavaScript's | `security/client-script-template-literal` | reviewed |
| `json()`, alone, is what a script may carry; a style reads a custom property | `security/json-in-script`, `diagnostics/script-json-not-alone` | reviewed |
| Hashes, not a nonce; the policy names what shipped, `html()` included | `security/csp-meta` | reviewed |
| `style-src` carries no hash by default | `security/csp-meta` | reviewed |
| `frame-ancestors`, `report-uri`, `report-to`, `sandbox` ride in a header, the same on every page | `security/csp-header-directives` | reviewed |
| A static host serves the meta half and not the header | A property of `dist/static` as files, not of an HTTP answer | - |
| `directives` replaces the defaults; `'hashes'` places the digests; an empty directive is dropped | `security/csp-custom` | reviewed |
| `reportOnly` sends the whole policy as a report-only header | `security/csp-report-only` | reviewed |
| `permissionsPolicy: true` turns off eleven features | `security/permissions-true` | reviewed |
| `features` replaces the list; `[]` is nobody, `['self']` is this page | `security/permissions-features` | reviewed |
| `permissionsPolicy` is off by default | `security/permissions-default-off` | reviewed |
| A generated project sets it to `true` | The create area | - |
| `nosniff` on every response | `security/csp-meta`, `endpoints/envelope` | reviewed |
| HSTS and `Referrer-Policy` are the app's, in `app/server.js` | `security/own-headers` | reviewed |

## /docs/middleware

Complete.

| Claim | Case, or why none | Snapshot |
| --- | --- | --- |
| `app` is a Hono instance, so Hono's middleware works | `endpoints/cors`, `security/own-headers` | reviewed |
| `app/server.js` reaches a rendered page, a prerendered page and a public file | `middleware/server-header` | reviewed |
| The order: trailing-slash redirect, CSRF, `app/server.js`, public files, routes | `middleware/order`, `middleware/server-header` | reviewed |
| A real file beats a `[...path]` catch-all | `middleware/public-before-routes` | reviewed |
| Middleware does not run during the build | Not visible over HTTP: the middleware runs again when the prerendered file is served | - |
| `gated` leaves its paths out of the sitemap, and the middleware still answers them | `middleware/gated` | reviewed |
| The build writes no file for a gated path | A property of `dist/static` as files. A gated page served from a file and one rendered per request answer the same bytes | - |
| `/api/*` matches `/api` and everything under it | `middleware/gated` | reviewed |
| An entry that is not a path fails the build | `diagnostics/gated-not-a-path` | reviewed |
| An entry that covers no route, URL or public file fails the build | `diagnostics/gated-covers-nothing` | reviewed |
| A layout guard is already caught | `diagnostics/prerender-reads-cookie` | reviewed |
| `trailingSlash: 'never'`, the default: `/about/` answers 301 | `middleware/trailing-slash-never` | - |
| `trailingSlash: 'ignore'`: both URLs answer 200 | `middleware/trailing-slash-ignore` | reviewed |
| `canonical: true` names the same URL either way | `middleware/canonical` | reviewed |

## /docs/refusals

Started.

| Claim | Case, or why none | Snapshot |
| --- | --- | --- |
| `"fragment" takes no value`, refused with the file, the line and the id | `diagnostics/fragment-takes-no-value` | reviewed |
