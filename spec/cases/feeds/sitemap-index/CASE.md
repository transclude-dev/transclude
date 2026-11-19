Past `limit` URLs the bare path answers with an index, and each sheet is a
file of its own: `/sitemap-0.xml`, `/sitemap-1.xml` and on. Five URLs with
`limit: 2` make three sheets. A sheet the index does not name is a 404, and
`?p=` is no longer read, because a static host ignores a query.

Source: `/docs/feeds`, "Sitemap", the 50,000 rule with `limit` lowered.
