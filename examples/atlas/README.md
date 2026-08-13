# Atlas

A reader for the AT Protocol network. Give it a handle, a DID or an `at://` URI
and it shows you what is there, and every hop it made to find it.

```sh
npm install
npm run dev     # http://localhost:1971
```

Try `/at/bsky.app`.

## One route, three views

An AT-URI names a repository, a collection in it, or one record. The number of
parts decides which, so one file answers all three:

```
/at/bsky.app                                   the repository and its collections
/at/bsky.app/app.bsky.feed.post                one collection
/at/bsky.app/app.bsky.feed.post/3msqpusnigc2t  one record
```

That file is `app/routes/at/[...uri].html`. Its loader is a sequence of calls
into `app/lib/`, and the last one is chosen by what the URI named.

## The chain is the app

Everything here is a view over `app/lib/identity.js`:

```
handle ──> DID ──> DID document ──> PDS
```

Each arrow is one lookup. `app/lib/` holds one file per step, and none of them
imports an SDK. A repository on this network is readable by anybody with its
address, so the whole thing is `fetch`, a query string, and JSON back.

## The trace rail is the point

Every page shows the path it took, with the time each hop cost and whether it
came from the cache. An answer is only as trustworthy as the route to it, and a
reader who wants to check can repeat the requests by hand.

It is also how you debug this app. Building it first was the cheapest decision
here.

## A handle is a claim until it is confirmed

A DID document can say it belongs to any handle at all. Only that handle's own
DNS record or web server can confirm it, so this app checks in both directions
and labels the result:

- **verified** — the handle leads to the DID, and the DID claims the handle.
- **claimed, not confirmed** — the DID claims a name that does not lead back.

An unconfirmed identity still renders. Refusing to show it would hide the more
interesting of the two cases. The accent color in the stylesheet is reserved for
this one distinction and spent nowhere else.

## DNS without `node:dns`

Two lookups here are DNS TXT records. `node:dns` would do it, and would then be
the only thing in the app that does not run on Workers.

So `app/lib/dns.js` asks a resolver over HTTPS and reads JSON back. One code
path, the same on Node, Bun, Deno and Workers, and no branch anywhere that names
a runtime.

## Two caches, different jobs

`export const revalidate = 30` on the route caches a **rendered page**, keyed by
its URL. `app/lib/cache.js` caches the **pieces a render is built from**, keyed
by what was asked for.

They are separate because a DID document is read by the record view, the
identity view, and every embed of either. Merge them and the second reader pays
the first reader's network cost again.

## Every view is also a fragment

The raw block carries an `id` and a `fragment` attribute, so it has a URL:

```
GET /at/bsky.app?fragment=raw
```

That returns the `<pre>` and nothing else, from the same markup that renders it
in the page. This is what the embed route is built on.

## Tests

```sh
npm test
```

`fetch` is replaced rather than the modules being mocked, so the tests exercise
the real chain down to the request it would have sent. Nothing here touches the
live network.

The one thing that cannot be checked this way is whether the real endpoints
still answer in this shape. That belongs in a check somebody runs on purpose.

## What is not built yet

Phase one resolves and renders JSON. Still to come: the renderer that reads the
lexicon instead of dumping the record, the `/embed` route, and `<at-record>`.
