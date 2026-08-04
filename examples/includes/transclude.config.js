// Transclusion, which is what this framework is named after.

export default {
  appDir: 'app',
  port: 1967,
  stylesheet: 'app/styles/global.css',

  // Documents this app may read. Default deny: with no host named here there is
  // no proxy route at all, and an external include cannot resolve.
  //
  // Naming one is a decision about someone else's work, not only about a
  // hostname. See app/routes/elsewhere.html.
  proxy: {
    allow: ['developer.mozilla.org'],
  },
};
