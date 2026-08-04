// The posts, as data. A real blog reads Markdown off disk or rows out of a
// database; the shape below is what either one would hand back, so the routes
// do not change when the source does.
//
// `body` is markup, not text. The page renders it through `html()`, which is a
// claim that it is yours. Anything a visitor could type goes in a field that is
// interpolated normally and escaped.

/**
 * @typedef {object} Post
 * @property {string} slug
 * @property {string} title
 * @property {string} summary
 * @property {Date} date
 * @property {string} body markup, vouched for by whoever wrote it
 */

/** @type {Post[]} */
export const posts = [
  {
    slug: 'a-page-is-a-file',
    title: 'A page is a file',
    summary: 'The directory tree is the route table, so a new page is a new file.',
    date: new Date('2026-02-11'),
    body: `
      <p>
        There is no route table to keep in step with the pages. The directory is
        the table. <code>app/routes/about.html</code> answers
        <code>/about</code>, and moving the file moves the URL.
      </p>
      <p>
        That sounds small until a site has eighty pages. Nothing can disagree
        with anything, because there is only one place the answer is written.
      </p>
    `,
  },
  {
    slug: 'written-once',
    title: 'Written once, served as bytes',
    summary: 'A page that does not read the request can be a file, and this one is.',
    date: new Date('2026-03-02'),
    body: `
      <p>
        Every page on this blog is rendered at build time and written to
        <code>dist/</code>. No loader runs when you ask for one. The server
        reads bytes off a shelf, compressed once, with an ETag it did not have
        to compute.
      </p>
      <p>
        The rule that decides it is simple: a page that reads a cookie or the
        query string cannot be a file, because a file is one answer for every
        visitor. Everything else can.
      </p>
    `,
  },
  {
    slug: 'two-files-for-machines',
    title: 'Two files for machines',
    summary: 'A sitemap and a feed, from the route table and a list you supply.',
    date: new Date('2026-04-19'),
    body: `
      <p>
        <code>/sitemap.xml</code> comes from the route table, which already
        knows every URL. <code>/feed.xml</code> cannot: a route table holds
        paths, and a feed needs titles and dates. So the config hands it a list.
      </p>
      <p>
        Both are served by the app and written into the build, so a host that
        runs none of this still has them.
      </p>
    `,
  },
];

/** Newest first, which is the order a blog is read in. */
export const byDate = () => [...posts].sort((a, b) => b.date.getTime() - a.date.getTime());

/** @param {string} slug */
export const find = (slug) => posts.find((post) => post.slug === slug) ?? null;
