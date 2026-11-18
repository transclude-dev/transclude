Build output is compressed once, and each encoding gets its own ETag. An
`If-None-Match` that matches answers 304.

Source: `/docs/production`, "Caching".

The ETags hash the page's bytes, so they change with the markup the
framework writes around it. A change to them belongs with the change to the
markup.
