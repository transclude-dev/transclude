// This site's own middleware, registered before the route table.
//
// Both `transclude.dev` and `www.transclude.dev` are custom domains on the
// worker, so both reach here. One of them has to be the address: every page
// emits a <link rel="canonical"> naming the apex, and two hostnames serving one
// document is how a search engine ends up choosing for you.

/** @param {import('hono').Hono} app */
export default function server(app) {
  app.use('*', async (c, next) => {
    const url = new URL(c.req.url);
    if (url.hostname !== 'www.transclude.dev') return next();

    // 301, because this is permanent and the apex is the name. The path and the
    // query travel with it, so a link to www/docs/fragments still lands there.
    //
    // The scheme is set rather than inherited. This hostname only exists on the
    // live site, which is always TLS, and inheriting it would send a plain HTTP
    // visitor to a plain HTTP address for a second redirect to arrive at.
    url.protocol = 'https:';
    url.hostname = 'transclude.dev';
    return c.redirect(url.toString(), 301);
  });

  // URLs this site had and has removed: the newsletter, its signup form and the
  // confirmation step behind it, the blog and its feed. A 404 is the answer for a
  // URL that never existed. These did, so each says it is gone.
  //
  // 410 rather than 404 is the difference between missing and removed: a crawler
  // retries a 404 for months and drops a 410 on the next pass. `all`, because the
  // form posted to `/subscribe`. Text rather than a page, since a body nobody is
  // meant to read is not worth a template.
  for (const gone of ['/newsletter/*', '/subscribe', '/confirm', '/blog', '/blog/*', '/feed.xml']) {
    app.all(gone, (c) => c.text('Gone. The documentation is at /docs.\n', 410));
  }

  // A fragment URL answers with one region of a page and no <head>, so it
  // carries no <link rel="canonical"> naming the page it came from. Two URLs,
  // one piece of markup, and nothing saying which of them is the address: a
  // search engine reads that as a duplicate and picks for itself. The header
  // says read this, do not index it, which keeps the fragment fetchable and
  // leaves the whole page as the only address.
  app.use('*', async (c, next) => {
    await next();
    if (new URL(c.req.url).searchParams.has('fragment')) c.header('X-Robots-Tag', 'noindex');
  });
}
