import { posts } from './app/lib/posts.js';

export default {
  feed: {
    hostname: 'https://acme.com',
    title: 'Acme',
    description: 'Latest from Acme.',
    items: async () => [
      ...(await posts()).map((post) => ({
        title: post.title,
        path: `/posts/${post.slug}`,
        date: post.date,
        description: post.summary,
      })),
      { title: 'Undated', path: '/posts/undated' },
      { title: 'Full', path: '/posts/full', date: '2026-01-01', content: '<p>All of it, <b>bold</b>.</p>', author: 'Ada' },
    ],
  },
};
