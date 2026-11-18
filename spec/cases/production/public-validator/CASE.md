A public file must be revalidated, and it carries a validator. A request that
sends its `ETag` back gets a 304 with no body.

Source: `design/internals.md`, "A public file's validator is its size and mtime, not a hash of it."
The ETag comes from the file's size and mtime, and the build's copy changes
the mtime, so the case sends back what the first answer gave it.
