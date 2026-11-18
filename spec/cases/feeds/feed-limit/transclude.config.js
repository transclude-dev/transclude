export default {
  feed: {
    hostname: 'https://acme.com',
    title: 'Acme',
    items: async () =>
      Array.from({ length: 51 }, (_, i) => ({
      title: `Post ${i}`,
      path: `/posts/${i}`,
      date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
    })),
  },
};
