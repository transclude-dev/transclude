# Blog

A prerendered blog. Every page is written to a file by the build, with a
sitemap and a feed beside them.

```sh
npm install
npm run dev     # http://localhost:1963
npm run build   # writes dist/, then look at what is in it
```

## What to look at

**`app/routes/posts/[slug].html` exports `paths()`.** A parameter route has no
URLs the build can guess, so it stays a server render until the page names
them. With `paths()`, each post becomes a file and appears in the sitemap.

**A missing post sets a status rather than throwing.** `response.status = 404`
in the loader, and the same page renders a short message. The build refuses to
write a file for any URL whose loader answered with something other than 200,
so `/posts/nope` never becomes a page.

**The body is markup, so it goes through `html()`.** That is a claim that the
value is yours. Anything a visitor could type belongs in a field that is
interpolated normally and escaped.

**The two machine-readable files come from different places.**
`/sitemap.xml` is built from the route table, which already knows every URL.
`/feed.xml` cannot be: a route table holds paths, and a feed needs titles and
dates, so `transclude.config.js` supplies the items.

**Nothing ships.** `curl localhost:1963 | grep script` finds nothing, and a
test asserts it.

**`/precache.json` lists what the build produced**, because `precache: true` is
in the config. A page carries its ETag, a hashed asset carries `revision: null`
because its name is its version, and `version` changes when any entry does.
Nothing in this app reads it: a service worker would, and
[the production docs](https://transclude.dev/docs/production) show one.

## Tests

```sh
npm run build && npm test
```
