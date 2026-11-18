import { posts } from './app/data/posts.js';

export default {
  sitemap: { hostname: 'https://acme.com' },
  feed: {
    hostname: 'https://acme.com',
    title: 'Acme',
    items: async () => posts().map((post) => ({ title: post.title, path: `/posts/${post.slug}` })),
  },
  onError: (error, { url, route, phase }) => {
    console.error(JSON.stringify({ error: error.message, url, route, phase }));
  },
};
