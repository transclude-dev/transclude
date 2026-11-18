`sameSite: 'None'` without `secure: true` is refused, because every browser
drops that pair without a word. With `secure: true` the cookie is written.

Source: `/docs/cookies`, the write defaults.
