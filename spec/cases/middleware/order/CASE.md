The trailing-slash redirect and CSRF run before `app/server.js`. The 301 for
`/about/` and the 403 for a form post with a foreign origin carry no header
from `app/server.js`. A same-origin post and a `GET` reach it, and carry it.
So does a file in `app/public/`, because `app/server.js` runs before the
public files.

Source: `/docs/middleware`, "The order".
