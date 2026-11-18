With the default `trailingSlash: 'never'`, a trailing slash on a URL a
catch-all matches is redirected with a 301. The catch-all does not answer it
as a path ending in `/`.

Source: the gotcha "`strict: false` and `trimTrailingSlash` exclude each
other" in `design/internals.md`, and `/docs/config`, `trailingSlash`.
