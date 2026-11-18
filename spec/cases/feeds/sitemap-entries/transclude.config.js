import { posts } from './app/lib/posts.js';

export default {
  sitemap: {
    hostname: 'https://acme.com',
    entries: async () =>
      (await posts()).map((post) => ({ path: `/posts/${post.slug}`, lastmod: post.date })),
    exclude: ['/admin', /^\/draft\//],
  },
};
