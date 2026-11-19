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
| The page and the fragment come from one template, so they agree | The fragment equivalence invariant. Two cases disagree: see Invariants | - |
| `#list` never reaches the server | Browser behavior, not the framework's | - |
| `<transclude src="/notes#list">` resolves while the page renders | The includes area | - |
| `setHTMLUnsafe` builds a declarative root, `innerHTML` does not; a bare shadow element in a fragment starts with either | `elements/in-a-fragment`, in Chrome, for the bare element. A declarative root in a fragment is the browser's | reviewed |
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
| Generated hostile values through `${}` in text and in attribute values read back as themselves, and add no element or attribute | `security/escaping-generated`, the `escaping` property below | reviewed |
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
| `each` over 0, 1 and n items, nested, renders each item once, in order, with its index | `routing/each-count-generated`, the `loop count` property below | reviewed |
| `key` on a page changes nothing | `routing/key-on-page` | reviewed |
| `key` keeps input values, focus and scroll across a reorder | `elements/key-keeps-focus`, in Chrome | reviewed |
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
| Page CSS reaches a light element; a shadow one only through inherited properties and `::part()` | `styles/boundary-in-browser`, in Chrome | reviewed |
| A light element ships JavaScript only with behavior; a shadow one always | `elements/javascript-shipped` | reviewed |
| Re-render on an attribute change: light in place, shadow including structure | `elements/rerender-on-attribute`, in Chrome | reviewed |
| After `bind` and `update`, the element is what a full render of the new props makes | `elements/every-binding`, and every element case, through the `bind and update` invariant | reviewed |
| A light element's slots are filled on the server, named and fallback included, and no `<slot>` is sent | `elements/light-slots` | reviewed |
| `slotchange` and `assignedNodes()` work only in a shadow element | `elements/slots-in-browser`, in Chrome | reviewed |
| An `if` or `each` over a changing value in a light element is refused, naming `shadow` | `diagnostics/light-element-structural-directive` | reviewed |
| A light element of plain markup ships nothing | `elements/javascript-shipped` | reviewed |
| In a fragment, a light element arrives whole and a shadow one bare | `elements/in-a-fragment` | reviewed |
| A shadow element in a fragment paints on connect | `elements/in-a-fragment`, in Chrome | reviewed |
| The server writes `referenceTarget` on the declarative shadow root | `elements/reference-target` | reviewed |
| A label, `aria-labelledby` and the like reach the target | `elements/reference-target`, in Chrome: the label. `aria-labelledby` needs the accessibility tree, which the runner does not read | reviewed |
| The target id must exist, be written out, sit outside an `each`, and the element must be shadow | `diagnostics/reference-target-missing-id`, `-bound-id`, `-in-each`, `-on-light` | reviewed |
| Chrome and Edge follow the target, Safari and Firefox do not | Browser support, not the framework's | - |
| `connected` gets a `signal` that aborts on disconnect | `elements/lifecycle`, in Chrome | reviewed |
| A `document` listener with no `signal` is a build warning | Build output, which the runner does not read. The second claim to need it | - |
| `prototype` members; `connected`, `disconnected`, `updated`; cleanup order | `elements/lifecycle`, in Chrome | reviewed |
| State: each element its own copy, a property per name, a re-render on set, `updateComplete` | `elements/state-in-browser`, in Chrome | reviewed |
| A name in both `properties` and `state` is a compile error | `diagnostics/prop-and-state-same-name` | reviewed |
| State renders on the server with its default, and nothing is reflected | `elements/state-default` | reviewed |
| A boolean state is a custom state CSS can select | `elements/state-in-browser`, in Chrome | reviewed |
| Objects and arrays are written as JSON in the attribute | `elements/shadow-element`, and `routing/attribute-values` | reviewed |
| `formAssociated` needs no shadow root | `elements/form-associated` | reviewed |
| Its value is submitted under its `name`; `setValidity`, `:invalid`, a blocked submit | `elements/form-in-browser`, in Chrome, its message pointing at the inner button, as the note under it says | reviewed |
| A disabling `<fieldset>` sets the `disabled` custom state | `elements/form-in-browser`, in Chrome | reviewed |
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

## /docs/cookies

Complete.

| Claim | Case, or why none | Snapshot |
| --- | --- | --- |
| The docs loader reads a plain and a signed cookie | `cookies/read` | reviewed |
| `cookies.get` is the value, or `undefined` | `cookies/read`, `cookies/get-missing` | reviewed |
| `cookies.set` writes on the response | `cookies/write-defaults`, `endpoints/response-cookies` | - |
| `cookies.delete` expires it | `cookies/delete` | reviewed |
| `cookies.all()` is every cookie, on a null-prototype object | `cookies/all` | reviewed |
| `cookies.signed.get` is the value if the signature holds, else `undefined` | `cookies/read`, `cookies/forged` | reviewed |
| `cookies.signed.set` signs and writes | `cookies/read`, `cookies/forged` | reviewed |
| Write defaults: `Path=/`, `HttpOnly`, `SameSite=Lax`, `Secure` over TLS | `cookies/write-defaults` | - |
| An option you pass wins | `cookies/options-win` | - |
| `sameSite: 'None'` without `secure: true` is refused | `cookies/samesite-none-refused` | reviewed |
| `cookies.signed` throws with no `cookieSecret` | `cookies/signed-needs-secret` | reviewed |
| Use `globalThis.process?.env` in the config | Advice about a runtime with no `process`; phase 4 | - |
| Only dev invents a secret | The dev server is not this boundary. Production refusing is `cookies/signed-needs-secret` | - |
| A forged cookie reads the same as a missing one | `cookies/forged` | reviewed |
| A flash crosses a redirect once | `cookies/flash` | reviewed |
| `curl -L` does not send a cookie set on the hop it follows | About curl, not the framework | - |

## /docs/styles

Complete.

| Claim | Case, or why none | Snapshot |
| --- | --- | --- |
| `stylesheet` names one file, built by Vite: `@import`, nesting and PostCSS work | `styles/stylesheet` | reviewed |
| `stylesheet: null`, the default, links nothing | Every case with no config, such as `styles/style-hoisted` | reviewed |
| Custom properties cross a shadow boundary, selectors do not; `::part()` | `styles/boundary-in-browser`, in Chrome | reviewed |
| A `<style>` in a page or a layout is hoisted into `<head>` | `styles/style-hoisted` | reviewed |
| In an element it is scoped to the tag, and `:scope` is the element | `elements/light-element`, `elements/in-a-fragment` | reviewed |
| An element in a fragment brings its styles, added to `<head>` once | `styles/fragment-styles-once`, in Chrome, with `watchElements` | reviewed |
| A shadow element's `:host` rules live inside its shadow root | `elements/shadow-element`, `elements/in-a-fragment` | reviewed |
| Page CSS beats `:scope` at any specificity; page CSS on the host beats `:host`, and reaches nothing inside | `styles/boundary-in-browser`, in Chrome | reviewed |
| A view-transition rule is CSS only; both documents carry it | `styles/style-hoisted`: the rule passes through untouched. The transition itself needs a browser | reviewed |
| A name derived from the data in a `style` attribute | `styles/transition-name` | reviewed |

## /docs/feeds

Complete.

| Claim | Case, or why none | Snapshot |
| --- | --- | --- |
| A hostname mounts `/sitemap.xml`; without one there is none | `feeds/sitemap-routes`, `feeds/sitemap-off` | reviewed |
| Every page route with no parameters is listed; a parameter route as its `paths()` | `feeds/sitemap-routes` | reviewed |
| A route with no `paths()` is left out | `feeds/sitemap-routes` | reviewed |
| A draft is left out | `routing/draft-left-out` | reviewed |
| `entries` as a function or an array; `exclude` by path or pattern | `feeds/sitemap-entries`, `feeds/sitemap-entries-array` | reviewed |
| An entry naming a route's URL is listed once, with the fields of both | `feeds/sitemap-entries` | reviewed |
| Past `limit` URLs the bare path is an index and `?p=` a slice | `feeds/sitemap-index`, with `limit: 2`. The 50,000 default is the same rule | reviewed |
| `feed` mounts `/feed.xml` as RSS 2.0 | `feeds/feed-rss` | reviewed |
| Each item needs a `title` and a `path`; the rest is optional; `content` is full HTML | `feeds/feed-rss`, `feeds/feed-item-needs-title` | reviewed |
| Newest first, capped at 50, or at `limit` | `feeds/feed-rss`, `feeds/feed-limit`, `feeds/feed-limit-set` | reviewed |
| `format: 'atom'` writes Atom 1.0; `path` moves the feed | `feeds/feed-atom` | reviewed |
| Atom needs an author, the feed's or every item's | `feeds/feed-atom-needs-author` | reviewed |
| Atom needs a date: an item's, or `updated` | `feeds/feed-atom-needs-date`, `feeds/feed-updated` | reviewed |
| Nothing reads the clock; the feed is stamped from its newest item | `feeds/feed-rss`, `feeds/feed-updated`. Same bytes every run is the determinism invariant | reviewed |
| Nothing writes a `<link rel="alternate">` for the feed | `feeds/feed-rss` | reviewed |
| Both are written into `dist/static` | A property of the build output, not of an HTTP answer | - |

## /docs/markdown

Complete.

| Claim | Case, or why none | Snapshot |
| --- | --- | --- |
| `notes.md` answers `/notes`, as `notes.html` would | `markdown/page` | reviewed |
| One of each in a directory, and the build refuses | `diagnostics/markdown-and-html-same-url` | reviewed |
| `markdown` is a function from source to HTML; it is given the file | `markdown/page` | reviewed |
| A `.md` page with no converter is an error naming the file | `diagnostics/markdown-without-converter` | reviewed |
| The `<script server>` loader is the same block | `markdown/page` | reviewed |
| CommonMark passes a `<script>` block through raw | The parser's rule, and the parser is the app's. The cases use a converter of a few lines | - |
| No frontmatter and no YAML | An absence. `markdown/page` has the loader as its only block | - |
| Interpolation, directives and fragments work | `markdown/page`, `markdown/fragment` | reviewed |
| Type checking works, and a diagnostic points into the converted HTML | `npm run check` output, not an HTTP answer | - |
| A closing script tag inside the loader turns the rest into prose | The parser's rule | - |
| Elements need blank lines; inline tags do not | The parser's rule | - |
| `\${` is the escape in any page | `markdown/escape` | reviewed |
| Escape code tokens in the converter with `walkTokens` | Code in the app's converter | - |
| A name starting with `_` answers no URL, directories included | `markdown/underscore-skipped` | - |

## /docs/languages

Complete.

| Claim | Case, or why none | Snapshot |
| --- | --- | --- |
| `lang` in the config lands on `<html>` | `languages/lang-config` | reviewed |
| It defaults to `en` | Every case with no config, such as `languages/page-lang` | reviewed |
| A generated project writes the key out | The create area | - |
| A bare `<html>` in a page merges in and wins over the config; `dir` rides along | `languages/page-lang`, `layouts/html-attrs` | reviewed |
| Logical CSS properties flip with the text | Browser behavior, not the framework's | - |
| A locale is a route parameter; `/cy/about` and `/en/about` reach one file | `languages/locale-route` | reviewed |
| Both URLs are in the sitemap and prerendered | `languages/locale-route`, once the docs example gained its `paths()` | reviewed |
| `Accept-Language` is read in middleware, which redirects from the bare path | `languages/negotiate` | - |
| Redirect, do not vary | Advice about caches | - |
| No message catalog, plural engine or negotiation ship; `Intl` does most of it | Absences, and the platform's | - |

## /docs/icons

Complete.

| Claim | Case, or why none | Snapshot |
| --- | --- | --- |
| `app/icons/` compiles to `/icons.svg`, a `<symbol>` per file, named by the file | `icons/sprite` | reviewed |
| A subdirectory is a library served under its name; two libraries may share an icon name | `icons/libraries` | reviewed |
| A sheet ships every icon in it; nothing prunes it | `icons/sprite` | reviewed |
| The build reports the icon count | Build output, which the runner does not read | - |
| `viewBox` and paint are carried over; `width` and `height` are dropped | `icons/sprite` | reviewed |
| A new project has `svg-icon.html` | The create area | - |
| The docs `svg-icon`: drawn on the server, light DOM, no JavaScript, hidden unless labeled | `icons/svg-icon` | reviewed |
| `1em` and `currentColor` follow the surrounding text | Browser behavior | - |
| `iconsDir: null` is no icons | `icons/off` | - |
| `iconsDir` may name several directories, a path may leave `appDir`, and a library of one name is one sheet | `icons/shared-dirs` | reviewed |
| The same icon in two directories stops the build, naming both | `diagnostics/icon-in-two-dirs` | reviewed |
| An icon with no `viewBox` is refused by name | `diagnostics/icon-needs-viewbox` | reviewed |
| A directory inside a library is refused | `diagnostics/icon-library-nested` | reviewed |
| A library and a public file at one URL stop the build | `diagnostics/icon-library-public-collision` | reviewed |
| The dev server stops on the same collision | The runner checks the build only | - |
| `<use>` draws in its own tree, and `href` is same-origin | Browser behavior | - |

## /docs/config

Complete. Most keys have their own page, and their rows are there.

| Claim | Case, or why none | Snapshot |
| --- | --- | --- |
| An unknown key throws, naming it and every key | `diagnostics/config-unknown-key` | reviewed |
| A key naming a thing takes `null` for none; a feature takes `true` or an object | Each key's own case: `icons/off`, `config/fragment-param-off`, `security/csp-meta`, and the rest | - |
| `routesDir`, `elementsDir`, `publicDir`, `iconsDir` sit inside `appDir` and follow it | `config/app-dir` | reviewed |
| `outDir`, `stylesheet`, `typesFile` are read from the project root | `styles/stylesheet` for the stylesheet. `outDir` and `typesFile` name build output, not an HTTP answer | reviewed |
| `routesDir` and `publicDir` name other directories | `config/dirs-renamed` | reviewed |
| `cache`, `metadataBase`, `onError`, `port`, `precache`, `speculate` | The production area | - |
| `canonical` needs `metadataBase`, and says so | `diagnostics/canonical-needs-metadata-base` | reviewed |
| A page or layout writing its own canonical replaces it | `config/canonical-own` | reviewed |
| An empty `cookieSecret` is refused at startup | `diagnostics/cookie-secret-empty` | reviewed |
| `csp`, `csrf`, `elementsDir`, `feed`, `fragmentHeader`, `iconsDir`, `lang`, `markdown`, `permissionsPolicy`, `proxy`, `sitemap`, `stylesheet`, `trailingSlash`, `watchElements` | Each key's own area: security, forms, elements, feeds, fragments, icons, languages, markdown, includes, styles, middleware | - |
| `fragmentParam` names the parameter; `null` turns fragments off | `config/fragment-param`, `config/fragment-param-off` | reviewed |
| `typecheck`, `typecheckStrict`, `typesFile` | The dev server and the checker, not an HTTP answer | - |
| The whole file, every key written out, is accepted | `config/whole-file` | reviewed |

## /docs/production

Complete.

| Claim | Case, or why none | Snapshot |
| --- | --- | --- |
| `npm start` serves `dist/` on 1960; `PORT` wins | Starting a server, not an `app.request()`: phase 4 | - |
| Every page is a file unless it says `prerender = false` | `production/cache-control`, and every case with a prerendered page | - |
| A page that reads a cookie, answers with a `Response` or sets a status cannot be prerendered | `diagnostics/prerender-reads-cookie`, `prerender-response`, `prerender-status` | reviewed |
| A loader that throws fails the build, naming the page, the error and the line | `diagnostics/prerender-throws` | reviewed |
| A page that exports an action stops the build unless it says `prerender` | `diagnostics/prerender-action` | reviewed |
| `prerender = true` lets a page with an action be a file, and the action still runs | `production/prerender-true-with-action` | reviewed |
| `speculate: true`: prerendered URLs in `prerender`, server routes in `prefetch`, endpoints in neither | `production/speculate` | reviewed |
| `eagerness` and `exclude`, matched against the emitted pattern | `production/speculate-options` | reviewed |
| A browser acts on the rules, or ignores them | Browser behavior | - |
| `/people/*` asked for as a URL answers 404 | `routing/route-table` shows a parameter route answering for a name it does not know | - |
| `Cache-Control` per kind of response; the 500 page is `no-store` with no ETag | `production/cache-control` | reviewed |
| Build output is compressed once; each encoding gets its own ETag | `production/encodings` | - |
| Public files are served with byte ranges | `production/public-files` | reviewed |
| `Content-Type` from one table, `application/octet-stream` for an unknown kind | `production/public-files` | reviewed |
| The build prints the kinds it could not type | Build output, which the runner does not read | - |
| `nosniff` on every response | `production/public-files`, `endpoints/envelope` | reviewed |
| `404.html` and `500.html` are served as built | `production/error-pages` | reviewed |
| A layout above them reading a cookie stops the build | `diagnostics/error-page-layout-cookie` | reviewed |
| `ctx.request` is `null` while prerendering | `routing/context-fields` | reviewed |
| In production the error is logged and kept out of the page | `production/error-pages` | reviewed |
| In dev the stack is shown | The dev server | - |
| A page loads a script only if something on it needs one | `elements/javascript-shipped` | reviewed |
| `ctx.absolute()` uses `metadataBase`, or the request's host without it | `production/absolute`, `production/absolute-no-base` | reviewed |
| `onError` gets the request, URL, method, route, params and phase; the 500 page ships | `production/on-error` | reviewed |
| `revalidate` holds a render; inside the window the loader does not run | `production/revalidate-held` | reviewed |
| Past the window the held page goes out and a fresh one renders behind it | `production/revalidate-stale` | reviewed |
| One render at a time per URL, however many requests arrive together | The runner asks one request at a time. Concurrency is phase 3 | - |
| The key is the path and the query | `production/revalidate-key` | reviewed |
| The rebuild is held with `ctx.after`, `waitUntil` on workerd | Phase 4, every runtime compared | - |
| A rebuild that throws leaves the held page; the error goes to `onError` | `production/revalidate-rebuild-throws` | reviewed |
| `revalidateTag` from an action or an endpoint drops every page with the tag | `production/revalidate-tags` | reviewed |
| A prerendered loader calling it stops the build | `diagnostics/prerender-revalidate-tag` | reviewed |
| Not held: a cookie read, a header set, a `Response`, a status outside 2xx | `production/revalidate-not-held` | reviewed |
| A loader reading `Authorization` off `ctx.request` is invisible to the cache | Advice. The cache sees what `production/revalidate-not-held` shows | - |
| `cache` takes any store with the four methods | `production/cache-store`, `production/cache-store-async` | reviewed |
| `precache: true` writes `/precache.json`: pages and public files with ETags, assets with `revision: null`, a `version` | `production/precache`, `production/precache-off` | reviewed |
| `npm run dev` answers `/precache.json` with a 404 | The dev server | - |
| No service worker ships | An absence | - |
| A reporter that throws is caught; without one the error is logged | `production/on-error-throws`, `production/error-pages` | reviewed |

## /docs/runtimes

Complete. Almost every claim here is about a runtime other than Node, and the
runner is Node. Phase 4 serves every case on all four.

| Claim | Case, or why none | Snapshot |
| --- | --- | --- |
| The same app runs on Node, Bun, Deno and workerd | Phase 4 | - |
| workerd refuses to compile WebAssembly at runtime | workerd behavior; phase 4 | - |
| On Node, a stop signal drains before the process leaves | A signal to a process, not an HTTP answer | - |
| `workerFrom` builds the app on the first request and reads `env.COOKIE_SECRET` | workerd; phase 4 | - |
| `dist/edge` holds the public files, the assets and a `_headers` file | Build output, not an HTTP answer | - |
| Cloudflare answers `/about` with `about.html` | Cloudflare's behavior | - |
| `TRANSCLUDE_ROOT` starts the walk for the config elsewhere | Starting a server; phase 4 | - |
| `deno compile` and `bun build --compile` binaries | Phase 4, which the `runtimes` CI job already starts | - |
| Node 22 is the floor | The `node` CI job | - |
| What differs: bytes, hashing, compression, ranges | Phase 4 compares the answers | - |
| Bindings arrive on `env`; a loader's context names no runtime | workerd; phase 4. `routing/context-fields` lists the context | - |
| A page reading a binding or calling `after` needs `prerender = false` | `diagnostics/prerender-after` | reviewed |
| `ctx.after` takes a promise the reader does not wait for | `runtimes/after`. On Node nothing in `src/` waits for the work, so no change breaks only this; the case fails when `after` is missing | reviewed |
| A function is refused rather than wrapped | `runtimes/after-function-refused` | reviewed |
| A rejection goes to `onError`; the response does not change | `runtimes/after-rejects` | reviewed |

## /docs/testing

Complete. The runner is what this page describes: a built app asked through
`app.request()`.

| Claim | Case, or why none | Snapshot |
| --- | --- | --- |
| `@transclude/core/production` answers the way the server does | Every case | - |
| The redirect, CSRF, middleware, cookies, the cache and the route table all run | `middleware/order`, `forms/csrf-default`, `cookies/read`, `production/revalidate-held`, `routing/route-table` | reviewed |
| It reads a build, so build first and skip without one | Advice about a test file | - |
| `node --test` has no `.env`, so a signed cookie answers 500 | `cookies/signed-needs-secret` | reviewed |
| A form post needs an origin, or CSRF refuses it | `forms/csrf-default` | reviewed |
| The page and the fragment agree | `fragments/marked-element`. For every fragment, the fragment equivalence invariant | reviewed |
| A browser is needed for upgrades, shadow roots, focus and swaps | Advice to an app. The spec's own browser cases are `npm run spec:browser` | - |

## /docs/types

Complete. `transclude-check` is a command, not an HTTP answer.

| Claim | Case, or why none | Snapshot |
| --- | --- | --- |
| A misspelled field, an unknown prop, a prop of the wrong type | The checker | - |
| `typecheckStrict`, JSDoc, inferred loader types | The checker | - |
| `data-*`, `aria-*` and `hx-*` pass through, an expression included | `types/pass-through` shows the rendered half. Whether the checker accepts them is the checker's | reviewed |
| `transclude-env.d.ts` is generated where `typesFile` says | Build output | - |
| The editor setting, the language server, the extension | The editor | - |
| The dev server checks in the background, and `typecheck: false` stops it | The dev server | - |

## /docs/project-layout

Complete.

| Claim | Case, or why none | Snapshot |
| --- | --- | --- |
| `.html` in `routes/` is a page, `.js` an endpoint | `routing/route-table`, `endpoints/json-api` | reviewed |
| Everything in `elements/` is a custom element, light unless it exports `shadow` | `elements/light-element`, `elements/shadow-element` | reviewed |
| A `_` prefix keeps a helper out of the route table | `project-layout/underscore-helper`, `markdown/underscore-skipped` | reviewed |
| `_layout.html`, `[name].html`, `[...path].html`, `404.html`, `500.html` | `layouts/wraps-page`, `routing/route-table`, `production/error-pages` | reviewed |

## /docs/getting-started

Complete.

| Claim | Case, or why none | Snapshot |
| --- | --- | --- |
| `npm create @transclude` writes a project | The create area | - |
| Vite and TypeScript are optional peers, and a built app loads neither | Package metadata, and phase 6 | - |
| A project needs no `vite.config.js` | Every case: none has one | - |
| One that adds a Vite plugin is read | `getting-started/vite-plugin` | reviewed |
| `index.html` answers `/`; the loader returns what the markup reads | `routing/index-page`, `routing/route-table` | reviewed |
| The four commands and their port | Commands, not HTTP answers | - |
| `${}` is escaped; `html()` passes markup through | `routing/interpolation-escapes`, `security/html-in-place` | reviewed |

## /docs/how-it-works

Complete. The compiled module is the `./compiler` export, outside the
contract. What it produces is checked through HTTP.

| Claim | Case, or why none | Snapshot |
| --- | --- | --- |
| The module's exports: `load`, `render`, `regions`, `css`, `client`, `includes` | The `./compiler` export, outside the contract | - |
| A fragment is the same markup the page renders | `fragments/marked-element`; the fragment equivalence invariant | reviewed |
| The build prerenders, or names the page and exits | `diagnostics/prerender-reads-cookie`, `prerender-response`, `prerender-status` | reviewed |
| The order of what answers a request | `middleware/order`, `middleware/server-header`, `middleware/public-before-routes` | reviewed |
| Inside the route: layouts, the action, the loader, render, includes | `layouts/guard-redirect`, `layouts/guard-action`, `fragments/post-unknown-name` | reviewed |
| The same module four ways | `fragments/marked-element`, `forms/post-redirect-get`, `includes/another-route` | reviewed |
| The `<script server>` block never appears in the page | `how-it-works/server-script-stays` | reviewed |
| A page ships JavaScript only for an element with behavior | `elements/javascript-shipped` | reviewed |

## /docs/recipes

Complete. Most recipes repeat a claim another page makes, and the case is
there.

| Claim | Case, or why none | Snapshot |
| --- | --- | --- |
| Load data, a dynamic route, a 404, a redirect | `routing/route-table`, `routing/response-status`, `routing/loader-response` | reviewed |
| A submission, a rejected one, two buttons | `forms/post-redirect-get`, `forms/intent-field` | reviewed |
| A JSON endpoint, a cookie, a session, a guard, a header, middleware | `endpoints/json-api`, `cookies/read`, `layouts/guard-redirect`, `middleware/server-header` | reviewed |
| x402 | A third-party middleware. `middleware/gated` holds the part that is ours | reviewed |
| A data block is emitted as written, not compiled | `recipes/data-block` | reviewed |
| A `${}` in a data block is refused | `diagnostics/data-block-takes-no-expression` | reviewed |
| A dialog, an accordion, findable hidden text, with no JavaScript | `recipes/platform-attributes`. The attributes pass through, and what they do is the browser's | reviewed |
| A fragment URL, an include, an element, revalidate, tags, a feed, a test | Their own pages' cases | - |

## /docs/accessibility

Complete. Most of the page is about the markup an author writes, which the
framework passes through.

| Claim | Case, or why none | Snapshot |
| --- | --- | --- |
| A page ships no JavaScript | `elements/javascript-shipped` | reviewed |
| A light element is in the page's DOM, so `<label for>` reaches it | `elements/light-element`, and `elements/light-focus` in Chrome for the label | reviewed |
| A new project's layout has a skip link and `aria-current` | The create area | - |
| `lang` on `<html>` | `languages/lang-config` | reviewed |
| A labeled icon is `role="img"`, a decorative one `aria-hidden` | `icons/svg-icon` | reviewed |
| A light element never replaces a child, so focus stays | `elements/light-focus`, in Chrome | reviewed |
| The framework adds no roles, invents no labels, reorders nothing | Every snapshot of plain markup, such as `recipes/platform-attributes` | - |

## /docs/browsers

Complete. The page is about browsers, and the server's part is shown
elsewhere.

| Claim | Case, or why none | Snapshot |
| --- | --- | --- |
| An element's own styles are wrapped in `@scope` | `elements/in-a-fragment`, `elements/light-element` | reviewed |
| What each browser does below each feature | Browser behavior | - |
| Speculation rules, `referenceTarget` and a CSP are optional | `production/speculate`, `elements/reference-target`, `security/csp-meta` | reviewed |
| The core imports nothing from `node:` | `test/portable.test.js`; phase 4 | - |

## /docs (the overview)

Complete. The overview restates claims each page makes, and the cases are
there.

## /docs/decisions

Complete. Most of the page explains a choice, and the behavior it names has a
case on its own page.

| Claim | Case, or why none | Snapshot |
| --- | --- | --- |
| A page does not stream; a `Link: rel=preload` header names the stylesheet, the entry and its chunks | `decisions/link-preload` | reviewed |
| The body is buffered for a strong ETag | `production/encodings` | - |
| An endpoint can answer with a stream | `endpoints/stream` | reviewed |
| `if` and `each` on one element is refused | `diagnostics/if-and-each-on-one-element` | reviewed |
| A page ships JavaScript only for an element with behavior | `elements/javascript-shipped` | reviewed |
| What a patch and a minor may change | Release policy | - |

## The pages that make no claim about behavior

`/docs/why`, `/docs/principles`, `/docs/compared`, `/docs/colophon`,
`/docs/contributing` and `/docs/examples` explain choices, compare frameworks
and describe this repository. Where one names a behavior, such as the cookie
defaults on `/docs/principles`, the page that owns it has the case. Nothing on
them is a claim of their own. `/docs/examples` points at apps under
`examples/`, whose own suites run in CI.

## /docs/refusals

Complete. The page is read out of the compiler, so it lists every refusal there
is: 49 of them, in the order the page shows. A refusal that is all holes is
named here by what it refuses.

| It refuses | Case | Snapshot |
| --- | --- | --- |
| An expression the compiler cannot emit | `diagnostics/expression-not-emittable` | reviewed |
| An expression that does not parse | `diagnostics/expression-malformed` | reviewed |
| A `<template shadowrootmode>` in an element | `diagnostics/element-stray-shadowroot-template` | reviewed |
| A page export the generated module already defines | `diagnostics/page-export-reserved` | reviewed |
| A script block that does not parse, with its line | `diagnostics/script-syntax-error` | reviewed |
| "…" on <…> has no "if" before it | `diagnostics/else-after-another-element`, `diagnostics/else-without-if` | reviewed |
| "fragment" takes no value. | `diagnostics/fragment-takes-no-value` | reviewed |
| `…` belongs to the framework. | `diagnostics/element-lifecycle-name` | reviewed |
| `…` is exported twice (line …) | `diagnostics/element-export-twice`. The parser refuses the duplicate first, so the message is its own | reviewed |
| `…` is not something an element declares. | `diagnostics/element-unknown-export` | reviewed |
| `…` must be `true` or `false`. | `diagnostics/shadow-flag-not-literal` | reviewed |
| `…` must be a string: the id of one element in the shadow root. | `diagnostics/reference-target-not-string` | reviewed |
| `…` on a <script head> cannot interpolate. | `diagnostics/script-head-attribute-interpolated` | reviewed |
| `<script …>` is now one `<script element>` block. | `diagnostics/script-properties-block` | reviewed |
| `export *` is not supported here. | `diagnostics/export-star` | reviewed |
| <… slot="…"> continues an if in the slot "…": a chain is one slot's | `diagnostics/slot-chain-crosses-slot` | reviewed |
| <… src="…"> is none of "#id" for a fragment of this page, "/path#id" for another route, or an absolute URL for a document elsewhere. | `diagnostics/include-src-unrecognized` | reviewed |
| <… src="…"> names a document but no piece of it. | `diagnostics/include-names-no-piece` | reviewed |
| <…> carries "fragment" but has no id. | `diagnostics/fragment-without-id` | reviewed |
| <…> carries "fragment" inside a loop, so it has no id of its own and its markup depends on a loop variable the fragment could not be given. | `diagnostics/fragment-in-loop` | reviewed |
| <…> carries "fragment", which addresses a fragment of a page over HTTP. | `diagnostics/fragment-in-element`, `diagnostics/fragment-in-layout` | reviewed |
| <…> carries both "each" and "…". | `diagnostics/if-and-each-on-one-element` | reviewed |
| <…> carries both "fragment" and "…". | `diagnostics/fragment-and-if` | reviewed |
| <…> forwards references to `…`, and no element in its template has `id="…"`. | `diagnostics/reference-target-bound-id`, `diagnostics/reference-target-missing-id` | reviewed |
| <…> forwards references to `…`, and that id is inside an `each`, so every item repeats it. | `diagnostics/reference-target-in-each` | reviewed |
| <…> has an interpolated id, so its name is not knowable at compile time and no URL could ask for it. | `diagnostics/fragment-id-interpolated` | reviewed |
| <…> has an interpolated src, so what it includes is not knowable at compile time. | `diagnostics/include-src-interpolated` | reviewed |
| <…> has no src. | `diagnostics/include-without-src` | reviewed |
| <…> includes a fragment of a page, and only a page has them. | `diagnostics/include-in-element` | reviewed |
| <…> interpolates an attribute name: "…". | `diagnostics/interpolated-attribute-name` | reviewed |
| <…> is a light element, so `referenceTarget` has no shadow root to reach into. | `diagnostics/reference-target-on-light` | reviewed |
| <…> is hoisted into <head> and <…> is not, so this chain would be split in two. | `diagnostics/hoisted-branch-split` | reviewed |
| <…> is never closed. | `diagnostics/include-never-closed` | reviewed |
| <…> is repeated and writes out a view-transition-name, so every copy would carry the same one. | `diagnostics/view-transition-name-repeated` | reviewed |
| <…> re-renders `…` by rebuilding structure, which a light element cannot do: it does not own its own children. | `diagnostics/light-element-structural-directive` | reviewed |
| <…>: `…` is declared in `…`, and it is a member the framework calls: it …. | `diagnostics/element-prop-named-for-hook` | reviewed |
| <…>: `…` is declared in both `properties` and `state`. | `diagnostics/prop-and-state-same-name` | reviewed |
| <script element> is already declared on line …. | `diagnostics/script-element-twice` | reviewed |
| <title> cannot carry a directive. | `diagnostics/title-takes-no-directive` | reviewed |
| <transclude src="#…"> names no fragment of this page. | `diagnostics/include-names-no-fragment` | reviewed |
| <transclude> includes itself: …. | `diagnostics/include-cycle`, `diagnostics/include-includes-itself` | reviewed |
| ${} inside <…> is written to the page as code, so a value could end the element or the statement it sits in. | `diagnostics/data-block-takes-no-expression`, `diagnostics/element-style-takes-no-expression`, `diagnostics/page-style-takes-no-expression`, `diagnostics/script-json-not-alone`, `diagnostics/script-takes-no-expression`, `diagnostics/style-takes-no-expression` | reviewed |
| a <script head src="…"> cannot also have a body. | `diagnostics/script-head-src-and-body` | reviewed |
| an element declares itself by name, so there is no default export. | `diagnostics/element-default-export` | reviewed |
| an element's code lives in <script element>. | `diagnostics/element-client-script` | reviewed |
| an export here declares one name, and this declares `…`. | `diagnostics/export-declares-two` | reviewed |
| each="…" is malformed. | `diagnostics/directive-takes-no-interpolation` | reviewed |
| exports "actions", which nothing reads. | `diagnostics/exports-actions` | reviewed |
| two fragments are both named "…". | `diagnostics/fragment-id-twice` | reviewed |

## Invariants

Rules that hold for every app, run over every case once its entries are
asked. `spec/invariants/` holds one module per invariant. A case that is about the
very thing an invariant forbids is exempt in its `invariants.json`, with the
reason.

| Invariant | What it asks | Broken in `src/` to see it fail | Exempt |
| --- | --- | --- | --- |
| fragment equivalence | Each page behind a request, then `?fragment=<id>` for each marked id it holds. The fragment must be the page's copy, less its declarative shadow roots | A fragment that keeps its shadow roots fails 2 cases. A fragment that answers the page's whole body fails 6 | `routing/context-fields`, which prints `url` and `fragment` |
| unknown fragment | `?fragment=` with each id the page has unmarked, each name an object inherits, and 20 generated names. Each must be 404 | An unknown name that answers the page fails 127 cases. A lookup with `in` for `Object.hasOwn` fails 126 | none |
| determinism | Each GET twice more, as it went. Status, every header and the body must be the same. Nothing is put aside | A random header on each render fails 59 cases | 4 cases whose loader counts its runs |
| light DOM by default | Each `<template shadowrootmode>` on a custom element, in every HTML answer. Its host's source must say `export const shadow = true`. A host with no hyphen is hand-written or foreign markup, and is not checked | Every element counted as a shadow element fails 14 cases | none |
| no client JavaScript unless asked for | Every HTML answer of a case whose source asks for no JavaScript: 181 of the 198 that build. No script the browser runs, and no `.js` in a `src`, an `href` or `Link` | Every page given its client entry fails 113 cases. A light element of plain markup defined in the browser fails 6 | 3 `security/csp-*` cases, whose page writes a `<script>` through `html()` |
| bind and update | Each element a case defines, compiled through `@transclude/core/compiler`. 100 pairs of props generated from its defaults: render the first, `bind`, `update` to the second, and compare with a full render of the second. An `update` that answers false repaints, and is not compared. 6 elements are compared; 5 always repaint | `setText` that escapes fails 7 cases. `setAttr` that writes `false` fails 1, and `setParts` that keeps the last part fails 1, both `elements/every-binding`. A keyed move in reverse order fails 1 | none |

Fragment equivalence found that a page with an action could be a file while
its fragment rendered live, in `fragments/action-fragment` and
`fragments/post-unknown-name`. The build now refuses that page unless it says
`prerender`, and both cases say `prerender = false`.

Two rules need an app built for them, so each runs in one case, from the
case's `property.js`. fast-check generates the input, and a failure names the
smallest one it found.

| Property | Case | What it asks | Broken in `src/` to see it fail |
| --- | --- | --- | --- |
| escaping | `security/escaping-generated` | 300 values strung from hostile pieces and any character, through `${}` in text, a `<pre>`, a `<textarea>`, attribute values quoted three ways and an `each`. Each reads back as itself, and the elements and attributes are those of a plain `x` | `escape` that leaves `<`: `</pre>`. `attr` that leaves `"`: `"><b>` adds an element. `attr` that leaves `&`: `&quot` reads back as `"`. It found that a leading newline in a `<pre>` or a `<textarea>` was lost, fixed in this batch |
| loop count | `routing/each-count-generated` | 100 lists of rows of cells, nested `each`, the empty list and lists of one first. Each row and cell renders once, in order, with its index | A loop that skips the first item: `[[]]`. A loop that stops after three: four cells, three rendered, which no entry in the corpus notices. An index that stays at 0: `[[], []]` |

## Budgets

`spec/budgets.json`, run by `npm run spec`. Set on an Apple laptop and checked
against CI's own numbers:

| Budget | Measured when set | Limit | Pushed past on purpose |
| --- | --- | --- | --- |
| Client JavaScript | 24 cases ship some, 75 to 13,260 bytes; the rest none | a tenth above each, rounded up to 100; 0 for a case not named | 3,000 bytes added to the runtime fails 22 cases |
| Render time | a median of 0.03 to 0.05 ms in process | 0.25 ms, for six requests in five cases | 1 ms added to every request fails all six |
| Packed size | 297,019 bytes | 312,000 | a 27 kB file in `src` fails it |
| `www` build | 7.4 s here, 13 s on CI | 20 s | 15 s added to the build fails it |

## Every runtime

`npm run spec:runtimes` replays every case that builds on Node, Bun, Deno and
workerd, over HTTP, and each answer must be Node's. 183 cases are served; the
93 that do not build, 3 with no request and 17 that read a fake upstream are
not. `spec/README.md` lists what is put aside.

Four cases are left off one runtime by their `runtimes.json`:

| Case | Runtime | Why |
| --- | --- | --- |
| `markdown/page` | workerd | The config imports `node:path` |
| `production/on-error-sitemap-feed` | workerd | Its data module reads a file with `node:fs` |
| `production/encodings` | workerd | wrangler compresses on the way out, as Cloudflare does |
| `forms/shared-response` | Deno, workerd | What a reused body does is the runtime's |

Broken in `src/` to see it fail: an `X-Runtime` header written on Bun alone
fails all 183 cases.

The first run found six bugs, each fixed on its own branch: a 500 that kept
the page's headers, Bun's text type lost in a copy, the Node adapter's
`Response` swap, the worker's own ETag, the worker's public files, and a 500
without `nosniff`. The gotchas below name each.

## In a browser

`npm run spec:browser` opens every case that defines an element in headless
Chrome, served on Node. Each page its `expect.json` asks for must load with no
error, and connecting its elements must change nothing in the body. 19 cases,
one page each.

Broken in `src/runtime/index.js` to see it fail: a light element that writes
its defaults over the server's values on connect fails 3 cases, and a shadow
element that adds a node on connect fails 6.

Cases with a `browser.json`, each broken in `src/runtime/index.js` to see it
fail:

| Case | What it asks in Chrome | Broken to see it fail |
| --- | --- | --- |
| `elements/rerender-on-attribute` | A light element writes into the text node it has; a shadow one rebuilds its `each` | `setText` that replaces the node; a keyed `each` that builds no new row |
| `elements/slots-in-browser` | A child added later is projected and fires `slotchange`; a light element has no `<slot>` left | The browser's own, and the server's fill, which the in-process run checks |
| `elements/lifecycle` | `connected`, `updated`, the signal aborting, the returned cleanup before `disconnected`, a move | `disconnected` before the cleanup; a signal never aborted |
| `elements/state-in-browser` | A property per name, `updateComplete`, a copy per element, `:state()` set with the render | A custom state never added |
| `elements/in-a-fragment` | A fragment swapped in paints its shadow element on connect | An element arriving bare that does not paint |
| `elements/reference-target` | A click on the label focuses the input inside | No `shadowrootreferencetarget` on the server's root |
| `elements/key-keeps-focus` | A reordered row keeps its value, focus and scroll | A keyed `each` that ignores the key |
| `elements/form-in-browser` | `FormData` reads the value; `setValidity` makes `:invalid` match and blocks a submit; a disabling fieldset is the `disabled` state, both ways | No `setFormValue`; no state added in `formDisabledCallback` |
| `elements/light-focus` | A label outside reaches an input inside; a re-render keeps that input focused | A light render that moves its children |
| `styles/boundary-in-browser` | A custom property crosses a shadow root, a global class stops at it, `::part()` reaches in; page CSS beats `:scope` and `:host` | Element styles hoisted without `@scope`; without the layer |
| `styles/fragment-styles-once` | With `watchElements`, an element swapped in twice brings its styles once, and they apply | `adoptStyles` that adds nothing |

The other claims marked "Needs a browser" get a `browser.json` each, batch by
batch.

## Gotchas

Phase 2 sorts every gotcha in `design/internals.md`. A behavioral one fails at
the boundary: a status, a header, a body, a build that stops or does not. Each
gets a case, the gotcha ends with `spec: <case id>`, and the case fails with
the old bug put back. An internal one is about how `src/` is written, or needs
something the runner does not have.

Gotchas are named by their bold title, in file order. Line numbers move with
every edit to the file.

### Behavioral, shown by a case (124)

`Tagged` is `yes` once the gotcha ends with its `spec:` tag and the case
fails with the old bug put back. `Snapshot` is as in the sections above.

| Gotcha | Case | Tagged | Snapshot |
| --- | --- | --- | --- |
| A keyed `each` that met one key twice left a row behind. | `elements/every-binding`, through the `bind and update` invariant | yes | reviewed |
| Fragment mode emits components bare, and the flag has to reach all the way down. | `elements/shadow-inside-light-in-a-fragment` | yes | reviewed |
| A reference target has two places to be written, and missing one says nothing. | `elements/reference-target` | yes | reviewed |
| A `<script>` with a non-JavaScript type is markup, not a client block. | `recipes/data-block` | yes | reviewed |
| A client entry is one module, so a layout's relative import is rewritten. | `layouts/client-import-nested` | yes | reviewed |
| `draft` is filtered out of `manifest.routes` once, and the manifest is reassigned. | `routing/draft-left-out` | yes | reviewed |
| The build's context refuses rather than omits. | `diagnostics/prerender-after` | yes | reviewed |
| A page with an action was written to a file, and its fragment was not. | `diagnostics/prerender-action` | yes | reviewed |
| `ctx.after` catches the rejection before `waitUntil` sees it. | `runtimes/after-rejects` | yes | reviewed |
| Every export in `<script element>` declares one name, and `splice` works back to front. | `diagnostics/export-declares-two` | yes | reviewed |
| A prop or a state field cannot be named for a member the framework calls. | `diagnostics/element-prop-named-for-hook` | yes | reviewed |
| The reserved names are not module-scope declarations. | `elements/form-associated` | yes | reviewed |
| A light element writes; only a shadow one rebuilds. | `diagnostics/light-element-structural-directive` | yes | reviewed |
| The unused-prop check reads code and skips comments, and the `[^:]` in that regex is doing real work. | `diagnostics/warn-unused-prop` | yes | reviewed |
| `@scope` made an element's style win against the page, so it sits in a layer. | `styles/boundary-in-browser`, in Chrome | yes | reviewed |
| Both halves fence a block. Only the shadow half compiles one. | `elements/light-block-then-binding` | yes | reviewed |
| The caller sorts a light element's children into its slots. | `elements/light-slots` | yes | reviewed |
| State is behavior, so it defines the element. | `elements/state-only-defines` | yes | reviewed |
| `data()` is what a template sees, and the server has to build it too. | `elements/state-default` | yes | reviewed |
| Reacting costs a definition, and only a definition. | `elements/javascript-shipped` | yes | reviewed |
| The `No-Vary-Search` guard reads a header instead of writing one, and it has to run at request time. | `fragments/no-vary-search-hides-fragment` | yes | reviewed |
| A throw after the response exists answered with that response's headers. | `fragments/no-vary-search-hides-fragment` | yes | reviewed |
| The swap watcher is opt-in, and used to follow `fragmentParam`. | `fragments/watch-elements`, `routing/index-page` | yes | reviewed |
| A listener on `document` outlives the element that added it. | `diagnostics/warn-document-listener` | yes | reviewed |
| A warning prints once per version of a file, not once per compile. | `diagnostics/warn-document-listener` | yes | reviewed |
| A `<pre>` or a `<textarea>` lost the newline its content began with. | `routing/leading-newline-kept` | yes | reviewed |
| An action runs after the region is known to exist. | `fragments/post-unknown-name` | yes | reviewed |
| A layout guard is one of the things that can refuse a request, and it did not. | `layouts/guard-action` | yes | reviewed |
| A page's handlers are verb exports, the same as an endpoint's. | `forms/verbs` | yes | reviewed |
| A verb is a name on a list, not a shape. | `endpoints/verb-not-a-handler` | yes | reviewed |
| `ctx.response` is shared by reference, and has to be. | `layouts/layout-status` | yes | reviewed |
| A loader returning a `Response` answers the request and skips the render. | `routing/loader-response` | yes | reviewed |
| `serve.js` registers every route, not just `manifest.dynamic`. | `routing/unlisted-param` | yes | reviewed |
| The order middleware is registered in is the behavior, so it lives in one function. | `middleware/order` | yes | reviewed |
| `strict: false` and `trimTrailingSlash` exclude each other. | `routing/trailing-slash-catch-all` | yes | reviewed |
| `publicDir` is relative to `appDir`, like every other directory key. | `config/dirs-renamed` | yes | reviewed |
| The public copy skips what an operating system left there. | `production/public-junk` | yes | reviewed |
| `app/public/` is copied to `dist/public`, and Vite's own `publicDir` is off. | `production/public-files` | yes | reviewed |
| A public file's validator is its size and mtime, not a hash of it. | `production/public-validator` | yes | reviewed |
| A `serveStatic` wrapper has to return what it was given. | `production/public-files` | yes | reviewed |
| A cache store may answer with a promise. | `production/cache-store-async` | yes | reviewed |
| A header set in `onFound` lands only under `serve`. | `production/public-files` | yes | reviewed |
| One table says what a file is, and there were three. | `production/public-type-prototype` | yes | reviewed |
| Public files are served by Hono, build output by the in-memory cache. | `production/public-files` | yes | reviewed |
| A repeated `view-transition-name` is a compile error, because the browser's answer is silence. | `diagnostics/view-transition-name-repeated` | yes | reviewed |
| A refusal knew where it was and could not say. | `diagnostics/script-syntax-error` | yes | reviewed |
| Nine refusals said `region`, a word no page of the documentation contains. | `diagnostics/fragment-without-id` | yes | reviewed |
| Five of the seven mistakes a beginner makes compiled silently. | `diagnostics/warn-server-exports-nothing` | yes | reviewed |
| The expression error described jsep's grammar, not this one. | `diagnostics/expression-malformed` | yes | reviewed |
| The sprite is written after the public copy and before anything that reads `dist/public`. | `icons/sprite-in-precache` | yes | reviewed |
| `dist/edge` is made before `_headers` is written, not by the links. | `routing/index-page` | yes | reviewed |
| A prerender runs the page; a prefetch does not. | `production/speculate` | yes | reviewed |
| The rules are computed before the render pass and carried in the manifest. | `production/speculate` | yes | reviewed |
| The speculation block is hashed by the CSP that already exists. | `security/csp-speculation` | yes | reviewed |
| A directory inside a library is refused, not flattened or skipped. | `diagnostics/icon-library-nested` | yes | reviewed |
| One thing answers for `/icons.svg`, and the two servers pick opposite winners. | `diagnostics/icon-sprite-public-collision` | yes | reviewed |
| parse5 closes an SVG element by namespace, not by tag name. | `icons/svg-close` | yes | reviewed |
| An icon with no `viewBox` is refused, not warned. | `diagnostics/icon-needs-viewbox` | yes | reviewed |
| A library of one name in two icon directories is merged, not refused. | `icons/shared-dirs` | yes | reviewed |
| A `Response` that answers early still needs the envelope. | `layouts/guard-redirect`, `cookies/flash` | yes | reviewed |
| `parseSigned` says `false` for a forged cookie, not `undefined`. | `cookies/forged` | yes | reviewed |
| `cookies.all()` has a null prototype. | `cookies/all` | yes | reviewed |
| Only the dev server invents a cookie secret. | `cookies/signed-needs-secret` | yes | reviewed |
| A header naming a region is a hint; the query parameter is strict. | `fragments/header-unknown-name-ignored` | yes | reviewed |
| `404.html` and `500.html` are reached for, not routed to. | `production/error-pages`, `production/cache-control` | yes | reviewed |
| The directory holds routes; a page is one kind of route. | `diagnostics/routes-dir-named-pages` | yes | reviewed |
| How an element renders is read from the file, before anything is compiled. | `elements/shadow-element` | yes | reviewed |
| Every reader of `elementsDir` goes through `src/elements.js`. | `diagnostics/element-in-two-dirs` | yes | reviewed |
| `loadProject` refuses `partialsDir` and `componentsDir`. | `diagnostics/config-partials-dir`, `diagnostics/config-components-dir` | yes | reviewed |
| `<html>` is read with a second parse, because the fragment parser drops it. | `layouts/html-in-text-stays-text` | yes | reviewed |
| `Secure` follows the connection, and `X-Forwarded-Proto` is trusted only to turn it on. | `cookies/write-defaults` | yes | reviewed |
| `nosniff` is sent always; `X-Frame-Options` and HSTS are not. | `middleware/security-headers-default` | yes | reviewed |
| The `\0` prefix was what kept the production bundle from mapping. | `diagnostics/prerender-throws` | yes | reviewed |
| A preload hint is set on the way out, never on `ctx.response`. | `production/cache-control` | yes | reviewed |
| A page does not stream, and the synchronous render is why. | `endpoints/stream` | yes | reviewed |
| The chunks behind the entry are named up front, and only the build can name them. | `decisions/link-preload` | yes | reviewed |
| The precache list is a build artifact, and cannot be anything else. | `production/precache` | yes | reviewed |
| The framework's own `<meta>` defaults go through the merge too. | `layouts/viewport-replaced` | yes | reviewed |
| A config key lives in two lists, and only one of them is checked against. | `diagnostics/config-unknown-key` | yes | reviewed |
| `canonical: true` is refused in `withDefaults`, not at the render. | `diagnostics/canonical-needs-metadata-base` | yes | reviewed |
| `<head>` merges across the chain, `<meta>` and canonical by key. | `layouts/head-merge-by-key` | yes | reviewed |
| A hoisted tag's directive has to be decided before anything is emitted. | `routing/head-tags` | yes | reviewed |
| `renderHtmlAttrs` returns an object, not markup. | `layouts/html-attrs` | yes | reviewed |
| An endpoint's `Response` goes through the envelope too. | `endpoints/envelope` | yes | reviewed |
| A feed reads no clock. | `feeds/feed-updated` | yes | reviewed |
| A feed item with no title or path was published as `undefined`. | `feeds/feed-item-needs-title` | yes | reviewed |
| `]]>` has to be split, and it turns up in ordinary code. | `feeds/feed-cdata-split` | yes | reviewed |
| `prerender` is read off the page, never off its layouts. | `diagnostics/prerender-reads-cookie` | yes | reviewed |
| The CSP is hashes, not a nonce, because a prerendered page is a file. | `security/csp-per-page` | yes | reviewed |
| A hash never covers a `style` attribute, so `style-src` is not hashed. | `security/csp-meta` | yes | reviewed |
| `csp.js` uses `crypto.subtle`, not the injected `hash`. | `security/csp-meta` | yes | reviewed |
| Reading a cookie is what makes a page personal, not writing one. | `production/revalidate-not-held` | yes | reviewed |
| Three servers render pages, so the include context is built in one place. | `includes/another-route`, `includes/route-twice-loads-once` | yes | reviewed |
| Building the include context is half of it. Every render call site has to be handed it. | `includes/call-sites` | yes | reviewed |
| An included route reads cookies through the host's, and that is the point. | `diagnostics/include-reads-cookie` | yes | reviewed |
| One route included twice loads once, and the memo dies with the request. | `includes/route-twice-loads-once` | yes | reviewed |
| The loop guard is a chain, not a counter. | `diagnostics/include-cycle`, `diagnostics/include-chain-too-deep` | yes | reviewed |
| An external include is resolved before the render, because render is synchronous. | `includes/prerendered-reads-once` | yes | reviewed |
| Includes of one document share the read in progress, not only the copy. | `includes/remote-section` | yes | reviewed |
| A source nobody allowed throws; a source that is down falls back. | `diagnostics/include-host-not-allowed` | yes | reviewed |
| A src that is interpolated cannot be an include. | `diagnostics/include-src-interpolated` | yes | reviewed |
| An included region drops its id, and the region keeps it. | `includes/same-page` | yes | reviewed |
| `<transclude>` has no dash, and that is only safe because it never reaches the browser. | `diagnostics/include-never-closed` | yes | reviewed |
| A file in `elements/` with no dash in its name stops the build. | `diagnostics/element-name-needs-dash` | yes | reviewed |
| The proxy follows redirects itself, and that is the point. | `includes/redirects` | yes | reviewed |
| One IPv4 address has four spellings in IPv6, and only one was read. | `includes/private-addresses-v6` | yes | reviewed |
| Sanitize, then rewrite, then index. | `includes/sanitize-then-index` | yes | reviewed |
| `<base>`, `<link>` and `<style>` are stripped from foreign markup for the host page's sake, not the fragment's. | `diagnostics/proxy-styles-misspelled` | yes | reviewed |
| The slug table is built for the whole document, once. | `includes/generated-ids` | yes | reviewed |
| Template content is not addressable, and `childNodes` is why it looks like it is. | `includes/template-not-addressable` | yes | reviewed |
| The cleaning descends into a template, because a declarative shadow root is not inert. | `includes/sanitize` | yes | reviewed |
| SVG animation is stripped, because it writes an attribute after the check has read it. | `includes/sanitize` | yes | reviewed |
| A scheme is what the browser reads, not what the bytes spell. | `includes/sanitize` | yes | reviewed |
| XML 1.0 cannot carry a C0 control, so one has to be dropped before it is written. | `feeds/xml-control-chars` | yes | reviewed |
| A parser reads some elements' content as text, and the walk never cleans it. | `includes/sanitize` | yes | reviewed |
| A route that is not in the table still fails like one. | `production/on-error-sitemap-feed` | yes | reviewed |
| Report-only is a header, never a meta. | `security/csp-report-only` | yes | reviewed |
| `${}` in a `<script>` or a `<style>` is a compile error, and `json()` is the one way through. | `diagnostics/page-style-takes-no-expression` | yes | reviewed |
| A region name is attacker input, so look it up with `Object.hasOwn`. | `fragments/prototype-name` | yes | reviewed |
| A literal `${` is written `\${`, and the comment above the scanner said for a long time that it could not be written at all. | `markdown/escape` | yes | reviewed |
| The escape was applied to text and not to attributes. | `routing/escape-in-attribute` | yes | reviewed |
| The build cannot see a gate in `app/server.js`, and the failure looks like a success. | `middleware/gated`, `diagnostics/gated-not-a-path`, `diagnostics/gated-covers-nothing` | yes | reviewed |
| `gated` reaches the runtime through `routes.json`, not through a second config key. | `middleware/gated` | yes | reviewed |
| The sitemap merges a path it already has, rather than keeping the first copy of it. | `feeds/sitemap-entries` | yes | reviewed |

### Behavioral, case to write (0)

None. Every behavioral gotcha has a case.

### Internal (114)

| Gotcha | What it is about |
| --- | --- |
| `<template>` children are not `childNodes`. | How `src/` is written |
| `setHTMLUnsafe()`, never `innerHTML`. | A browser: phase 5 |
| Empty type shapes must be `{}`, not `Record<string, never>`. | The type checker or the generated types |
| The shim is `.js` on purpose. | How `src/` is written |
| `transclude-check` drives TypeScript 7, and refuses anything else by name. | The type checker or the generated types |
| A shim diagnostic that does not map is dropped. | The type checker or the generated types |
| A type name JSDoc cannot resolve is `any`, not an error. | The type checker or the generated types |
| TypeScript ignores `@satisfies` on a function declaration. | The type checker or the generated types |
| The shim's globals come from `expr.js`, and used not to. | The type checker or the generated types |
| Report parse failures directly. | The type checker or the generated types |
| Never bind twice. | A browser: phase 5 |
| `createElement` cannot express a namespace, and the parser will not enter one without a real tag. | A browser: phase 5 |
| Directive values are expressions, not interpolations. | A browser: phase 5 |
| A module variable does not bridge the two bundles. | Another runtime or a real listener: phase 4 |
| The dev server builds its own `ctx` too, and `test/context-shape.test.js` is what notices. | The dev server |
| The check ran one direction, and the type promised a field for three weeks. | The type checker or the generated types |
| The dev server mounts its own routes, so `createApp` is not the only list. | The dev server |
| Config defaults are applied in `createApp`, not in `loadProject`. | Another runtime or a real listener: phase 4 |
| The cache's own background work forgot `after`, which is the rule `after` exists for. | Another runtime or a real listener: phase 4 |
| `contextFor` names no runtime, and that is why it has no `env`. | Another runtime or a real listener: phase 4 |
| The form value is reported before the render, not after. | A browser: phase 5 |
| `formResetCallback` removes the value attribute. | A browser: phase 5 |
| `static formAssociated` can only be checked in a browser. | A browser: phase 5 |
| Nothing is hoisted out of `<script element>`, and that is the design. | How `src/` is written |
| `connected`, `disconnected` and `updated` are members the framework calls. | A browser: phase 5 |
| A synchronous cleanup runs synchronously, and the order depends on it. | A browser: phase 5 |
| A light element's styles are `@scope`, and `@scope` reached the last engine in March 2026. | A browser: phase 5 |
| A `<slot>` is as wide as the caller says. | A browser: phase 5 |
| The tag tells a fenced hole from a bare block. | How `src/` is written |
| The dev check is synchronous, and the yield between files is why that is fine. | The dev server |
| The dev check prints on a clean run, and that is not noise. | The dev server |
| The dev check writes no `transclude-env.d.ts`, and scheduling comes before the routing branch. | The dev server |
| `createChecker` has a `Checker` typedef because three callers hold one. | The type checker or the generated types |
| `baseApp` refuses an option it does not know. | The dev server |
| Nothing here may import upward. | How `src/` is written |
| An app has one port, and `PORT` beats the config. | Another runtime or a real listener: phase 4 |
| A bin needs `#!/usr/bin/env node`. | Release, CI or packaging |
| A rename has to cover `dataset.x` as well as `data-x`. | A browser: phase 5 |
| Check that the listener is yours before believing a server test. | The repository's own tests |
| `<style data-transclude="tag">` in `<head>` is an agreement, not decoration. | A browser: phase 5 |
| `define()` is transitive, and it is safe to call twice. | A browser: phase 5 |
| One rule decides who ships a client entry, in `clientManifest`. | The dev server |
| The two element classes are duplicated on purpose, and a test holds them together. | How `src/` is written |
| A test that loops over the thing it checks proves nothing. | The repository's own tests |
| The compiler leaves `>` in an attribute and escapes it in text. | The HTML escaping in the runtime; the head merge half is 1603 |
| `transclude-env.d.ts` has to compile, and one flag is why nobody saw that it did not. | The type checker or the generated types |
| A project needs no `vite.config.js`, so both bins register the compiler themselves. | The dev server |
| Vite needs the http server, so the server is built first. | The dev server |
| Invalidate before `ssrLoadModule` in dev. | The dev server |
| A release tag is written `--cleanup=verbatim`, or markdown loses its headings. | Release, CI or packaging |
| The `release` job's checkout is not shallow. | Release, CI or packaging |
| One job in `publish.yml` holds `id-token: write`, and it installs nothing. | Release, CI or packaging |
| `stage publish` stages, and a human publishes. | Release, CI or packaging |
| A rule nothing checks is a rule that drifts, and spelling was the proof. | The repository's own tests |
| A template file whose name starts with `_` becomes a dot on scaffold. | The project generator |
| The editor's built-in HTML validation misreads every element with props and state. | The editor |
| The extension looked for a package that does not exist. | The editor |
| A release page here is immutable, so an asset goes up with it or not at all. | Release, CI or packaging |
| A candidate has to be marked a prerelease twice. | Release, CI or packaging |
| `npm run check:src` was red for 476 errors, and nothing ran it. | The type checker or the generated types |
| `return` and a block comment holding a newline is `return;`. | How `src/` is written |
| The promise nothing pinned was the API itself. | Release, CI or packaging |
| A docs sample was wrong for as long as it had existed, and nothing read it. | The repository's own tests |
| The config table was pinned by its defaults and not by its types. | The type checker or the generated types |
| The type printer is a dependency, and now there is a canary for it. | The type checker or the generated types |
| A guard that exits first hides everything behind it. | The type checker or the generated types |
| The first thing `typescript-next` reported was not about TypeScript. | Release, CI or packaging |
| `npm test` reports `src/runtime/index.js` at 43%, and the number is an artifact. | The repository's own tests |
| Sixty-one passing checks were the whole of what anybody knew. | A browser: phase 5 |
| The four-runtime claim ran on one runtime. | Every runtime: `npm run spec:runtimes`, in the `runtimes` job |
| Bun keeps a text body's type out of its headers. | Bun: `npm run spec:runtimes`, in the `runtimes` job |
| The Node adapter swapped the global `Response`, and the framework asks `instanceof Response`. | A real Node listener: `npm run spec:runtimes`, in the `runtimes` job |
| A worker made its own ETag for the same bytes. | workerd: `npm run spec:runtimes`, in the `runtimes` job |
| A worker served a public file with less than Node did. | workerd: `npm run spec:runtimes`, in the `runtimes` job |
| A compiled binary is started outside the project it carries. | Another runtime or a real listener: phase 4 |
| A dotfile made the build look stale. | A startup log, not an answer to a request |
| The package shipped no type declarations. | Release, CI or packaging |
| Nothing builds at publish time, so a generated file has to be committed. | Release, CI or packaging |
| `typescript` was a required peer for a command most projects never run. | Release, CI or packaging |
| A documented snippet named a package that does not exist. | The repository's own tests |
| A directory in `files` publishes what git ignores. | Release, CI or packaging |
| A directive rule that matches the name alone leaves the value to the HTML grammar, which has moved past it. | The editor |
| A directive is only a directive inside a tag. | The editor |
| A file the edge serves never passes through `baseApp`. | Another runtime or a real listener: phase 4 |
| Internals are attached for a boolean state field, not for any state. | A browser: phase 5 |
| A custom state lands with the render, not with the assignment. | A browser: phase 5 |
| `updateComplete` is the microtask's own promise. | A browser: phase 5 |
| `formDisabledCallback` reflects to a state, not the `disabled` attribute. | A browser: phase 5 |
| A crawler reads the speculation block and asks for the pattern. | Advice: the emitted rule is right, and `speculate.exclude` is the lever |
| A library is a directory, so the URLs the sprite claims are not a fixed list. | The dev server |
| Dev builds the sprite per request; the build writes it once. | The dev server |
| A prerendered page hides what its loader needs. | Another runtime or a real listener: phase 4 |
| The core has no `node:` imports and no Node-only globals, and both are tested. | How `src/` is written |
| Strip comments before grepping source in a test. | The repository's own tests |
| Use `fileURLToPath`, never `url.pathname`. | How `src/` is written |
| The framework ships nothing that swaps a region into a page, on purpose. | A browser: phase 5 |
| `hx-*`, `data-*` and `aria-*` are not props. | The type checker or the generated types |
| Most of what `check:src` reported was the JSDoc being wrong, not the code being untypeable. | The type checker or the generated types |
| A source map is handed back from `load`, not written into the code. | The dev server |
| The page cache sees a cookie read and a header write, and nothing else. | Advice the docs give. `/docs/production` says not to set `revalidate` on a page that reads a header off `ctx.request`, and a case would pin the gap as the contract |
| A cache hit is sent the way a file is, and the work is kept beside the entry. | How `src/` is written |
| Two packages, and `@transclude/create` depends on neither. | Release, CI or packaging |
| `create/templates/` is what a new project is, and `_gitignore` is why. | The project generator |
| A route include is rendered, not fetched. | How `src/` is written |
| `transclude` is read before the component table. | The dash rule refuses `elements/transclude.html` first |
| Resolving a name is injected, because one runtime cannot do it. | Another runtime or a real listener: phase 4 |
| `src/extract.js` never runs on our own pages. | How `src/` is written |
| Markdown is converted in exactly two readers, and they must not disagree. | The type checker or the generated types |
| A diagnostic in a `.md` page is an offset into the converted HTML. | The type checker or the generated types |
| A closing script tag inside a `<script server>` block ends it in Markdown too. | The Markdown parser, which is the app's |
| Three places decide what a page file is. | The dev server |
| `src/gate.js` has no imports on purpose. | How `src/` is written |
| Nothing installs Vite or TypeScript for you. | Release, CI or packaging |
| Only `src/vite.js` may import `vite`. | Release, CI or packaging |
