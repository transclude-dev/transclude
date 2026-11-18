export default {
  feed: {
    hostname: 'https://acme.com',
    title: 'Acme',
    format: 'atom',
    author: { name: 'Ada Lovelace' },
    updated: '2026-05-01',
    items: async () => [{ title: 'First', path: '/posts/first' }],
  },
};
