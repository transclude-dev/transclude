A host that `proxy.allow` does not name is a mistake, so the include throws
even when it has children.

Source: `/docs/includes`, "Children are the fallback".

Marked `todo`. The refusal is caught with the unreachable sources, so the
children render and the build passes.
