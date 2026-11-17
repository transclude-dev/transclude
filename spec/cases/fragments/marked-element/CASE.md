An element with an `id` and a `fragment` attribute is its own URL:
`?fragment=<id>` answers that element and nothing else, and an unknown name
answers 404.

Source: `/docs/fragments`, "Mark a fragment", and the table under it.

The page differs from the docs example in two places, and both are faults in
the example:

- `export const prerender = false`. The loader reads the URL, and
  `/docs/production` says such a page needs it. Without it the build writes
  the page to a file, `GET /?q=ada` answers that file and lists everyone, and
  the fragment still filters. The page and its fragment then disagree.
- `toLowerCase()` on both sides. `'Ada Lovelace'.includes('ada')` is false, so
  the example as written answers an empty `<ul>`, not the one the docs show.

Snapshot: unreviewed.
