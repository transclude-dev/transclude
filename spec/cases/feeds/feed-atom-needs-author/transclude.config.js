export default {
  feed: {
    hostname: 'https://acme.com',
    title: 'Acme',
    format: 'atom',
    items: async () => [
      { title: 'First', path: '/posts/first', date: '2026-01-05', author: 'Ada' },
      { title: 'Second', path: '/posts/second', date: '2026-02-11' },
    ],
  },
};
