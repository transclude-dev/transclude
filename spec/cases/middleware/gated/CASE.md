`gated` in `app/server.js` tells the build which paths a middleware guards.
The build leaves them out of the sitemap, and they stay routes the middleware
answers at runtime. `/api/*` covers `/api` and everything under it. The open
page beside them is in the sitemap.

Source: `/docs/middleware`, "Paths that are not public".
