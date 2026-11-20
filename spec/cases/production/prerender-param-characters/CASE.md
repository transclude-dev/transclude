Each param `paths()` names is a file, served for the URL that names it
encoded. The page says whether the file or the server answered.

- `a b`, `50%`, `a?b` and `café` come from the file, at `/p/a%20b`,
  `/p/50%25`, `/p/a%3Fb` and `/p/caf%C3%A9`. The `%25` and `%3F` ones used to
  miss the file, which was written at `p/50%` and `p/a?b`, and the server
  rendered them again.
- `/p/a%2Fb` is the param `a/b`, which `paths()` does not name, so the server
  renders it.

Source: `/docs/production`, "Prerendering". The `urlFor` question in
`spec/DRILLS.md`, third round, found it.
