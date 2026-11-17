`app/routes/_layout.html` wraps every page beside and below it, and the page
renders into its `<slot>`. The layout's loader runs for each page, so `/` and
`/notes/today` each show their own `route.path`.

Source: `/docs/layouts`, the first example.
