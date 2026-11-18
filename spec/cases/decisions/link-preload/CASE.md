A page does not stream, and a `Link: rel=preload` header goes out first. It
names the stylesheet, the client entry and the chunks the entry imports, so a
proxy can turn it into a 103 while the page is still being made.

Source: `/docs/decisions`, on streaming.

Two pages use the element, so it is a chunk of its own and the header has one
to name. A prerendered page is already made, and sends no `Link`.
