`ctx.absolute()` on a page that is written to a file, with no `metadataBase`
in the config, stops the build. The message names the path and the key to set.
A prerendered page has no request to take an origin from.

Source: `/docs/config`, `metadataBase`, and `/docs/routing`, the `absolute`
field.
