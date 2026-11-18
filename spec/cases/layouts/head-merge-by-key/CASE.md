`<head>` merges across the layout chain. A page's `og:image` replaces the
layout's, and two the page writes itself both ship. Among links only
`rel="canonical"` is replaced. A `<meta>` with `>` in its value is replaced
whole, with nothing of it left in the document.

Source: the gotcha "`<head>` merges across the chain, `<meta>` and canonical
by key" in `design/internals.md`.
