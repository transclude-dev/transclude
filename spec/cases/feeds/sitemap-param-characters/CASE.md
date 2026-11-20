A `paths()` param that holds `%`, `?` or `#` is encoded in the sitemap, so
`50%` is `50%25` and `a?b#c` is `a%3Fb%23c`. Left as they were, the first is
no URL and the second is another one. A rest param keeps its slashes.

The pages are not prerendered here. What the build does with such a param is
a question of its own.

Source: `/docs/feeds`, "Sitemap". The third sitemap drill found it.
