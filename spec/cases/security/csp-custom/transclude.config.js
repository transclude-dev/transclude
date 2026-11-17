export default {
  csp: {
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'", "'hashes'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:', 'https://cdn.example.com'],
      'connect-src': ["'self'", 'https://api.example.com'],
      'object-src': ["'none'"],
      'frame-ancestors': ["'self'"],
      'media-src': [],
    },
  },
};
