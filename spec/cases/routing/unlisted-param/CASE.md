A URL a dynamic route matches and its `paths()` never listed is rendered by
the route, not handed to the 404 page. The page's own status and body answer
it.

Source: the gotcha "`serve.js` registers every route, not just
`manifest.dynamic`" in `design/internals.md`.
