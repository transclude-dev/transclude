The docs loader. With no cookies, `theme` falls back to `light` and the signed
`user` is `undefined`. A plain `theme=dark` reads back as it was sent, and a
signed `user` that an endpoint wrote reads back on the next request.

Source: `/docs/cookies`, the first example.
