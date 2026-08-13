# Atlas

A reader for the AT Protocol network. Give it a handle, a DID or an `at://` URI
and it shows you what is there, and every hop it made to find it.

```sh
npm install
npm run dev     # http://localhost:1971
```

Try `/at/bsky.app`.

## The lexicon drives the render

There is no renderer per record type here, and there must not be one. A record
arrives with a schema that says what each field is, and `app/lib/render.js`
turns the pair into a list of fields the templates print.

| Lexicon says | Rendered as |
| --- | --- |
| `string` | text |
| `string`, `maxGraphemes` | prose, with a meter showing how much of the limit was used |
| `string`, `format: at-uri` | a link to `/at/...` |
| `string`, `format: did` | a link to `/did/...` |
| `string`, `format: handle` | a link, with the verification state |
| `string`, `format: datetime` | `<time datetime>`, absolute and in UTC |
| `string`, `format: uri` | an external link, with its host |
| `string`, `format: language` | the tag and the language's name |
| `blob` | the image, or its type and size |
| `cid-link`, `bytes` | the hash, in mono |
| `array` of scalars | chips, inline |
| `ref`, `union`, `array` of objects | followed, and indented under the field |
| nothing | the value, marked as unschema'd |

Two things follow that a hardcoded renderer does not get:

A record type nobody has seen before renders properly the first time. Nothing in
`render.js` knows what a post is.

The schema page and the record page share the registry, so a field's
documentation and a live example of it agree by construction.

## Refs are followed, once

A lexicon rarely says what a field is where it names it. A post's `reply` is a
ref to `#replyRef`, whose `root` is a ref to `com.atproto.repo.strongRef`, whose
`uri` is finally a string with a format. Without following those, a reply renders
as four fields nothing describes.

So the schemas a lexicon points at are resolved once, up front, as a set. A
listing of fifty posts needs the same three lexicons as one post, and they are
cached for an hour.

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

A block with an `id` and a `fragment` attribute has a URL of its own:

```
GET /at/bsky.app?fragment=raw
```

That returns the `<pre>` and nothing else, from the same markup that renders it
in the page.

## Embedding is the point

`/embed/<uri>` serves one record with no navigation, open to any origin:

```html
<transclude src="https://atlas.transclude.dev/embed/did:plc:.../app.bsky.feed.post/3k2j#record">
  <p>The record could not be read just now.</p>
</transclude>
```

That is HTML, not an iframe, so the host page's stylesheet reaches it and no
JavaScript is involved. `/about` includes a record this way and is the proof:
read its source.

Anywhere that is not a transclude site, one script and one tag:

```html
<script type="module" src="https://atlas.transclude.dev/at-record.js"></script>

<at-record uri="at://did:plc:.../app.bsky.feed.post/3k2j">
  <a href="https://bsky.app/...">Read this post</a>
</at-record>
```

The children are the fallback. They show until the record arrives and they stay
if it never does, so no page is broken by this element: no script, no network
and an old browser all leave the link the author wrote.

**The contract is that this URL always answers with something you can put on a
page.** An embed outlives the record it points at, so a record that is gone gets
a tombstone and a 200, not a 404. A 404 would make `<transclude>` fall through
to the author's fallback, and their reader would never learn a record had been
there.

Cached for five minutes, and served stale for a day while it refreshes. Embeds
send other people's readers at other people's servers, and that header is what
protects them.

## Tests

```sh
npm test
```

`fetch` is replaced rather than the modules being mocked, so the tests exercise
the real chain down to the request it would have sent. Nothing here touches the
live network.

The one thing that cannot be checked this way is whether the real endpoints
still answer in this shape. That belongs in a check somebody runs on purpose.

## Most record types have no schema

That is the ordinary case on this network, not a failure. `/lexicon/<nsid>` says
so plainly and names the domains it asked. Records of that type still render,
field by field, from what they carry.

## The element is light DOM, and hand-written

Two decisions about `app/public/at-record.js` that look like oversights and are
not.

**No shadow root.** A shadow root would keep the host page's stylesheet out of
the record, and that stylesheet reaching it is the entire reason this serves HTML
instead of an iframe. A test asserts the file contains no `attachShadow`, because
it is a one-line change somebody could make without noticing.

**No framework.** The element is written by hand rather than exported from the
app that serves it. It fetches a URL and inserts the result; the element runtime
in `@transclude/core` is four kilobytes and none of it applies. The app's own
elements are compiled and server-rendered, and this one runs on strangers'
pages, so they have almost nothing in common but the word "element".

It is 1.8 KB gzipped, and it has to load cross-origin, which is what
`app/server.js` is for: a module script is fetched in CORS mode however it was
written in the markup.

## What is not built yet

Discovery. `com.atproto.sync.listReposByCollection` against a relay would
enumerate everyone using a lexicon, and Constellation would give backlinks —
what records point at this one. That is what turns this from an inspector into a
map, and it is also what `<lex-field>` needs: cross-highlighting a field on a
schema page wants live example records on that page, and there is no way to find
them yet.
