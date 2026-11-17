`app/elements/site-note.html` is `<site-note>`, rendered into the page's own
DOM. Its style block goes into `<head>` once, scoped with `@scope` so
`:scope` is the element, however many times it appears, including inside
another element. An empty use shows the slot's fallback.

Source: `/docs/elements`, the first example.
