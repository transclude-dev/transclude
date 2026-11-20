`exclude` is tested on the path as the sitemap writes it, encoded. That path
is also the key two mentions of one URL share.

- `/p/a b` leaves out the route URL for the param `a b` and the entry for
  `/p/a%20b`. The two are one URL.
- `/%C3%A9/` leaves out the param `é`, which the sitemap writes as `%C3%A9`.
- `limit: null` is the default, as `null` is none for `entries`, `exclude`
  and `paths()`.

Source: `/docs/feeds`, "Sitemap". The fifth sitemap drill found that a rule
tested each mention as written, so the entry kept the URL in the sitemap.
