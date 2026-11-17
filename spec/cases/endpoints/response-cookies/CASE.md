Status and headers go on the returned `Response`, and a cookie set through
`ctx.cookies` survives it: the docs example answers 201 with its `location`
and the `seen` cookie.

Source: `/docs/endpoints`, "The answer".
