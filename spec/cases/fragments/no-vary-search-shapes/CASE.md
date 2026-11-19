A `No-Vary-Search` header is read the way a cache reads it. A header that
hides `?fragment=` is refused with a 500, and one that hides nothing passes.
The app copies the header from `x-no-vary-search` on the request.

- `params;x` is refused. A bare key with parameters is still the bare key,
  and an older draft that browsers shipped reads bare `params` as every
  parameter.
- `params=?0`, `params=("utm_source");x` and
  `params=("fragment"), params=("utm_source")` pass. They ignore nothing, or
  `utm_source` only: a list's parameters say nothing, and a repeated key
  keeps its last value.
- `except`, `params=(utm_source)` and `params=("utm_source")x` are refused.
  They are shapes that cannot be read, and those count as hiding.
- `params=("fr%61gment")` is refused. A cache decodes each name the way it
  decodes a query key, so this one is `fragment`.
- `params=("utm_source"), except=("fragment")` and `params=("utm_source"),`
  are refused. A cache ignores both, so they are shapes that cannot be read.
- `PARAMS` passes. A cache ignores a header that does not parse, and this one
  names neither `params` nor `except`.

Source: `/docs/fragments`, the note "A header that hides the parameter is
refused", and `types/api/no-vary-search.d.ts`, which says a shape the server
cannot read counts as hiding. The drills in `spec/DRILLS.md` found these.
