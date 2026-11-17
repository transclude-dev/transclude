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
| `GET /?q=ada` is the whole document, `&fragment=matches` the `<ul>` alone, `?fragment=nope` a 404 | `fragments/marked-element` | unreviewed |
| The page and the fragment come from one template, so they agree | Phase 3, the fragment equivalence invariant | - |
| `#list` never reaches the server | Browser behavior, not the framework's | - |
| `<transclude src="/notes#list">` resolves while the page renders | The includes area | - |
| `setHTMLUnsafe` builds the shadow roots in a fragment | Needs a browser, phase 5 | - |
| `fragmentHeader: 'HX-Target'` makes `?fragment=` optional | `fragments/header-names-fragment` | unreviewed |
| A header naming no fragment is ignored | `fragments/header-unknown-name-ignored` | unreviewed |
| Naming a header in `fragmentHeader` adds it to `Vary` | `fragments/header-names-fragment` | unreviewed |
| A cache keys on the query string | Cache behavior, not the framework's | - |
| A `No-Vary-Search` naming other parameters passes through | `fragments/no-vary-search-named` | unreviewed |
| A `No-Vary-Search` hiding `?fragment=` is refused, naming the value | `fragments/no-vary-search-hides-fragment`. The 500 is checked; the message is in the log, which the runner does not read | unreviewed |
| `POST /?fragment=nope` changes nothing and answers 404 | `fragments/post-unknown-name` | unreviewed |
| `ctx.fragment` tells a form post from a fetch | `fragments/action-fragment` | unreviewed |
| `watchElements` puts a script on every page | `fragments/watch-elements` | unreviewed |
| `watchElements` is off by default | `routing/index-page`, whose page has no script | unreviewed |

## /docs/routing

Started.

| Claim | Case, or why none | Snapshot |
| --- | --- | --- |
| `routes/index.html` answers `/` with a whole document, `<title>` moved into `<head>` | `routing/index-page` | unreviewed |

## /docs/refusals

Started.

| Claim | Case, or why none | Snapshot |
| --- | --- | --- |
| `"fragment" takes no value`, refused with the file, the line and the id | `diagnostics/fragment-takes-no-value` | unreviewed |
