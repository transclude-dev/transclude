A page with `proxy.allow` includes a section of a document on another site.
The section renders and the children are dropped. Two fragments of the one
document cost one read.

Source: `/docs/includes`, "A document somebody else wrote", "Children are the
fallback", and `maxAge` under "Limits".

The read count is `todo`: two includes that start together read the document
twice, because nothing holds the first read while it is in flight.
