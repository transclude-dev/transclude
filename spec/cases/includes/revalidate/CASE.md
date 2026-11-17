Past `maxAge` the document is asked for again with its `ETag`, and a 304 keeps
the copy already read.

Source: `/docs/includes`, `maxAge` under "Limits".
