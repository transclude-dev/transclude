An endpoint's answer goes through the same envelope as a page's: it carries
`X-Content-Type-Options: nosniff`, and a cookie set on the way survives the
redirect it returns.

Source: `/docs/endpoints`, "What you get for free".
