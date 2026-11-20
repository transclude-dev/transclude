The values the sitemap drills found the old module and the rebuilt one read
differently, with the answer decided each time (`spec/DRILLS.md`):

- A `lastmod` is the day in UTC. One with an offset can fall on the next day.
  A number is a moment. A string that is no date, and `0`, are dropped.
- `priority: null` is no priority. `priority: 0` is one.
- A URL from `paths()` is percent-encoded: `a b` is `a%20b`.
- `null` from `paths()` is no URLs, the way the build reads it.
- A `g` flag on an `exclude` pattern leaves out every match, not every other one.
- A later mention of a path that leaves `lastmod` undefined keeps the earlier
  one.
- An entry path that is already encoded is not encoded again.
- `lastmod: true` is no date, so it is dropped.
- An entry for `/p/a%20b` and the route URL `/p/a b` are one URL, listed once
  with the entry's priority.
- A `%` that starts no escape is written as `%25`.
- `priority: ''` and `changefreq: 0` are written as none.
- A later `null` clears a field an earlier mention gave.

Source: `/docs/feeds`, "Sitemap". The docs say none of these. The drills did.
