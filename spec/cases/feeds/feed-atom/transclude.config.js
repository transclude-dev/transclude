export default {
  feed: {
    hostname: 'https://acme.com',
    title: 'Acme',
    format: 'atom',
    author: { name: 'Ada Lovelace' },
    path: '/atom.xml',
    items: async () => [
      { title: 'First', path: '/posts/first', date: '2026-01-05' },
      { title: 'Second', path: '/posts/second', date: '2026-02-11', description: 'More.' },
    ],
  },
};
