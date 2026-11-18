A throw in a page's `paths()` while `/sitemap.xml` is made, or in the feed's
`items()`, answers with the 500 page. `onError` hears it with the phase
`sitemap` or `feed` and no route.

Source: `design/internals.md`, "A route that is not in the table still fails like one."
`app/data/posts.js` is a database that is up for the build and down for the
server. The build reads it to write both files, and the server's read
throws.
