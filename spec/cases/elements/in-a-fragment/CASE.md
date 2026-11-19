In a fragment, a light element arrives whole. A shadow element arrives bare,
with no declarative shadow root, to paint itself on connect.

Source: `/docs/elements`, the note "A shadow root in a fragment paints on
connect".

The light element's style stays in the page's `<head>` and is not in the
fragment. `watchElements` on `/docs/fragments` is what brings it to a page
that never rendered the element.

In Chrome, the fragment swapped into the page paints its shadow element on
connect, from `/docs/elements`, the note "A shadow root in a fragment paints
on connect". It does so through `innerHTML` as well as `setHTMLUnsafe()`,
because the fragment carries no declarative shadow root.
