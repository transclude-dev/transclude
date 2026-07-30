// Hono middleware for this app. The default export is handed the app before any
// route is registered, which is the only position that can guard a prerendered
// page. `dist/static` is served by a handler that runs before every route.
//
// This is plain Hono. There is no framework wrapper to learn, and no list of
// blessed plugins: everything in `hono/*` works, and so does anything else
// written against Hono.
//
// Not free, though: middleware does not run during `npm run build`. A page
// behind a guard has to opt out of prerendering with `export const prerender =
// false`, or the build writes a logged-out copy to a file and the guard never
// sees the request.

/** @param {import('hono').Hono} app */
export default function (app) {
  // CSRF is already on. See `csrf` in transclude.config.js.

  // Sensible defaults for a server that serves HTML. Sets no
  // Content-Security-Policy, which matters here: this framework inlines
  // <style> and per-page <script>, and a default CSP would block its own output.
  // import { secureHeaders } from 'hono/secure-headers';
  // app.use('*', secureHeaders());

  // import { logger } from 'hono/logger';
  // app.use('*', logger());

  // import { basicAuth } from 'hono/basic-auth';
  // app.use('/admin/*', basicAuth({ username: 'me', password: process.env.PW }));

  // import { cors } from 'hono/cors';
  // app.use('/api/*', cors({ origin: 'https://app.example' }));

  // Lets a <form> send DELETE and PATCH through a hidden _method field, which
  // HTML itself cannot do, so the page's `DELETE` becomes reachable from markup.
  // import { methodOverride } from 'hono/method-override';
  // app.use('*', methodOverride({ form: '_method' }));

  // Already handled, in transclude.config.js rather than here. Each is one
  // decision the whole app has to agree on:
  //   trailingSlash: 'never'   301s /about/ to /about (hono/trailing-slash)
  //   publicDir: 'public'      files served at the root (hono serveStatic)
  //   fragmentHeader           a request header that may name a region; set it to
  //                            'HX-Target' and hx-target="#list" needs no ?fragment=
  //
  // On htmx and CSRF, since it looks like it should be a problem and is not:
  // htmx posts `application/x-www-form-urlencoded`, so the guard does apply, and
  // browsers send `Origin` and `Sec-Fetch-Site: same-origin` on a same-origin
  // non-GET, either of which satisfies it. Verified: same-origin htmx passes,
  // cross-site is 403.
  //
  // What does need saying: htmx only swaps 2xx by default. A rejected form that
  // answers 422 will not appear unless you configure htmx to swap it. This
  // framework returns 200 with the error rendered, which htmx swaps as-is.
  //
  // Do NOT add these two. The framework does them differently on purpose, and
  // doubling up is worse than either alone:
  //
  //   compress   hono/compress is gzip and deflate. CompressionStream has no
  //              brotli. The build writes brotli at quality 11 next to every
  //              file and serve.js sends it: measured on this app, −70% against
  //              −64%. Prerendered responses are compressed once, at build time,
  //              rather than on every request.
  //
  //   etag       serve.js gives each content-coding its own strong ETag, because
  //              with `Vary: Accept-Encoding` the identity and brotli bodies are
  //              different bytes and should not share one. hono/compress instead
  //              weakens the ETag to `W/`, which is also correct but gives up
  //              strong comparison. It also checks If-None-Match *before*
  //              compressing, so a revalidating client pays for a hash and
  //              nothing else.
  void app;
}
