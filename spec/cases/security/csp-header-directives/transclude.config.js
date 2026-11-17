export default {
  csp: {
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'", "'hashes'"],
      'frame-ancestors': ["'self'"],
      'report-uri': ['/csp-reports'],
      'report-to': ['csp'],
      sandbox: ['allow-scripts', 'allow-forms'],
    },
  },
};
