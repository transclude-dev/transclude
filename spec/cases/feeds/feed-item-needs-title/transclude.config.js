export default {
  feed: {
    hostname: 'https://acme.com',
    title: 'Acme',
    items: async () => [{ title: 'Fine', path: '/fine' }, { date: '2026-01-01' }],
  },
};
