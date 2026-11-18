export default {
  feed: {
    hostname: 'https://acme.com',
    title: 'Acme',
    format: 'atom',
    author: { name: 'Ada Lovelace' },
    items: async () => [{ title: 'First', path: '/posts/first' }],
  },
};
