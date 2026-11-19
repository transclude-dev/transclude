Both kinds of element re-render when an attribute changes. A light element
writes into the nodes already there, so the text node it wrote is the same
node afterwards. A shadow element rebuilds structure too: an `each` over a
new list renders a row per item.

Source: `/docs/elements`, "What each can re-render". The shadow element is
the docs example as printed.
