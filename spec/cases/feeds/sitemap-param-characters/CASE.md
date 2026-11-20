A `paths()` param that holds `%`, `?`, `#` or `/` is encoded in the sitemap,
so `50%` is `50%25`, `a?b#c` is `a%3Fb%23c` and `a/b` is `a%2Fb`. Left as
they were, the first is no URL and the others are other URLs. A rest param
keeps its slashes.

The pages are not prerendered here, so the build does not refuse `a/b`.
`production/prerender-param-characters` is the same params written to files.

Source: `/docs/feeds`, "Sitemap". The third sitemap drill found it.
