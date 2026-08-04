# Includes

The same content in more than one place, which is what the word transclusion
means. `<transclude src>` is resolved on the server, so the tag leaves no trace
in what arrives.

```sh
npm install
npm run dev     # http://localhost:1967
```

## Three sources, one tag

**The same page.** `src="#pricing"` renders a fragment of this page somewhere
else on it. The copy drops the `id`: two elements answering to one name is
invalid, and a swap aimed at that name would find whichever came first.

**Another route.** `/summary` includes `src="/notes#list"`. It is *called*, not
fetched: the same process, in the middle of that render, with no HTTP request
and no URL this server has to be able to reach itself at.

**Another site.** `/elsewhere` reads a section out of a page on another host,
through a proxy that is off until a host is named in `proxy.allow`. Default
deny: with no host named there is no proxy route at all.

The children of a `<transclude>` are the fallback, and they render when the
include cannot be resolved. `/elsewhere` shows its fallback with no network.

## Someone else's words are still theirs

Reading another site copies it. Your server reads the document and serves the
piece from your origin, as part of your page, and a prerendered page carries it
in a file that ships with your build.

Name a host only when you have the right to republish what it holds, and read
its license first: a share-alike license can put conditions on the page you put
the fragment in. Nothing is attributed for you, because a document does not
carry its author or its license anywhere a program can read them. The credit on
`/elsewhere` is written by hand.

## Tests

```sh
npm run build && npm test
```

The external include is not tested. It reads another host, and a test that needs
the network fails for reasons about the network.
