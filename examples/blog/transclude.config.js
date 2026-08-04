// A content site. Everything here is about the build: the pages are written to
// files, and the two files machines read are written beside them.

import { posts } from './app/data/posts.js';

const SITE = 'https://blog.example';

export default {
  appDir: 'app',
  port: 1963,
  stylesheet: 'app/styles/global.css',
  csp: true,

  // What `ctx.absolute()` resolves against, for a canonical URL and an og:image.
  metadataBase: SITE,

  // Mounts /sitemap.xml and writes it into the build. Every page route with no
  // parameters is listed, and a parameter route is listed as whatever its
  // `paths()` export names.
  sitemap: { hostname: SITE },

  // A feed needs something to read: a route table holds URLs and nothing else.
  // The items are the app's to supply.
  feed: {
    hostname: SITE,
    title: 'A transclude blog',
    description: 'Posts about building with HTML.',
    author: { name: 'Ada Lovelace' },
    items: () =>
      posts.map((post) => ({
        title: post.title,
        path: `/posts/${post.slug}`,
        date: post.date,
        description: post.summary,
      })),
  },
};
