`cookies.set` with no options writes `Path=/`, `HttpOnly` and `SameSite=Lax`.
Over plain HTTP there is no `Secure`. A request that came over TLS, as
`X-Forwarded-Proto: https` says, gets `Secure` as well.

Source: `/docs/cookies`, the write defaults.
