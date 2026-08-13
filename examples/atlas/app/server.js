// Hono middleware for this app. Plain Hono: the default export is handed the
// app before any route is registered.
//
// One job here, and it is not optional. `<at-record>` is a module script, and a
// browser fetches a module in CORS mode however it was written in the markup.
// Without the header below, `<script type="module" src="https://atlas.../at-record.js">`
// on somebody else's page fails to load and the element never defines itself.
//
// The route that serves the record already sets its own headers. This covers
// the file in `app/public/`, which the static handler serves and which no route
// touches.

/** @param {import('hono').Hono} app */
export default function (app) {
  app.use('/at-record.js', async (c, next) => {
    await next();
    c.header('access-control-allow-origin', '*');
    // An hour, and not `immutable`. This URL carries no version, so a year-long
    // immutable answer would leave every page that ever loaded it on the copy it
    // happened to get first, with no way to correct it.
    c.header('cache-control', 'public, max-age=3600');
  });
}
