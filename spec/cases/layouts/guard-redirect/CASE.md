A layout loader that returns a `Response` stops the request there. Signed out,
or with a cookie that was not signed, `/account` is a 303 to `/login`, and the
page's loader does not run: its count is 1 after both. Signed in through
`/login`, the page renders.

Source: `/docs/layouts`, "A layout can respond on its own".
