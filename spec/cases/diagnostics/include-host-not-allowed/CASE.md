A host that `proxy.allow` does not name is a mistake, so the include throws
even when it has children.

Source: `/docs/includes`, "Children are the fallback".

A redirect from an allowed host to one that is not is the source's doing, and
falls back like any other source that cannot be read.
