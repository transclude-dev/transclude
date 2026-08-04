// Everything this app tells the framework. Short on purpose: the defaults are
// most of it, and what is here is what this example actually uses.

export default {
  appDir: 'app',

  // Its own port, so it can run beside the showcase and the site.
  port: 1962,

  stylesheet: 'app/styles/global.css',

  // Nothing here inlines a script, and the policy costs nothing to leave on.
  csp: true,
};
