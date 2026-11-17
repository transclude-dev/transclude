CORS is Hono middleware in `app/server.js`. A preflight and a request from the
allowed origin get `Access-Control-Allow-Origin`, and one from another origin
does not.

Source: `/docs/endpoints`, "Calling it from another origin".
