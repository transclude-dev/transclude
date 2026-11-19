An include path is matched the way a request is, so `/notes/#notes` reaches
`/notes`. The old module found no route for it and rendered the fallback.

Source: `/docs/includes`, "A fragment of another route", and `/docs/config`,
`trailingSlash`.
