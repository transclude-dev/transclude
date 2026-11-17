`ctx.request` is a standard `Request`, and its body reads as it was sent:
`json()` parses, `text()` keeps the bytes exactly, `arrayBuffer()` counts
them, and `formData()` reads a form post.

Source: `/docs/endpoints`, "Reading the request", and the webhook note that a
signature covers the bytes as sent.
