The values the sitemap drill found the old module and the rebuilt one read
differently, with the answer decided then (`spec/DRILLS.md`):

- A `lastmod` is the day in UTC. One with an offset can fall on the next day.
  A number is a moment. A string that is no date, and `0`, are dropped.
- `priority: null` is no priority. `priority: 0` is one.
- A URL from `paths()` is percent-encoded: `a b` is `a%20b`.
- `null` from `paths()` is no URLs, the way the build reads it.
- A `g` flag on an `exclude` pattern leaves out every match, not every other one.

Source: `/docs/feeds`, "Sitemap". The docs say none of these. The drill did.
