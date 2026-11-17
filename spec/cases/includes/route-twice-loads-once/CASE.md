One route included several times runs its loaders once, so every fragment of
it on the page comes from the same data.

Source: `/docs/includes`, "A fragment of another route".

Marked `todo`. The memo is per fragment, not per route: `#count` twice shares
one run, and `#again` gets a second, so the page shows "1" and "2" from one
loader. The expected file says what the docs say.
