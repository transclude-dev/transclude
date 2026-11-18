export default {
  feed: {
    hostname: 'https://acme.com',
    title: 'Acme',
    limit: 2,
    items: async () =>
      Array.from({ length: 5 }, (_, i) => ({
      title: `Post ${i}`,
      path: `/posts/${i}`,
      date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
    })),
  },
};
