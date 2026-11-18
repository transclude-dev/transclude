A `Response` built on a `ReadableStream` is sent as the stream wrote it, with
its own content type and cache header. An endpoint that also sets a cookie
gets the cookie on the same `Response`, and the stream still arrives whole.

Source: `/docs/endpoints`, "A stream", and the gotcha "A page does not
stream, and the synchronous render is why" in `design/internals.md`.
