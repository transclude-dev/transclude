// Everything this app tells the framework. The state of a run lives in the
// query string, so nothing here holds a session, a store or a secret.

export default {
  appDir: 'app',

  // Its own port, so it can run beside the showcase and the site.
  port: 1973,

  stylesheet: 'app/styles/global.css',

  // Nothing here inlines a script the app wrote, and the policy costs nothing
  // to leave on. The speculation block below is inline and is hashed with it.
  csp: true,
};
