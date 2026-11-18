Every response carries `X-Content-Type-Options: nosniff`: a page, a 404 and a
public file. No response carries `X-Frame-Options` or
`Strict-Transport-Security` unless the app sets them.

Source: `design/internals.md`, "`nosniff` is sent always; `X-Frame-Options` and HSTS are not."
