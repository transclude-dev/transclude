`csp: true` gives the page a `<meta>` policy. `script-src` carries the sha256
of each inline script, one that arrived through `html()` included. `style-src`
is `'self' 'unsafe-inline'` with no hash, so a `style` attribute works.
`frame-ancestors` goes in the response header. The page carries `nosniff`.

Source: `/docs/security`, "Hashes, not a nonce", the note "Nothing to write",
and "Why styles are not hashed". Each hash was checked by hand against the
sha256 of the script text.
