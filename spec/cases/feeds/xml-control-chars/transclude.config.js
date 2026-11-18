export default {
  feed: {
    hostname: 'https://acme.com',
    title: 'Ac\x00me',
    items: [
      { title: 'Fir\x08st', path: '/posts/first', date: '2026-05-01', description: 'a\tb\x1bc' },
    ],
  },
  sitemap: {
    hostname: 'https://acme.com',
    entries: [{ path: '/about', changefreq: 'week\x01ly' }],
  },
};
