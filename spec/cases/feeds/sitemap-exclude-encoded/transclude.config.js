export default {
  sitemap: {
    hostname: 'https://acme.com',
    limit: null,
    entries: [{ path: '/p/a%20b', lastmod: '2026-07-31' }],
    exclude: ['/p/a b', /%C3%A9/],
  },
};
