// Everything this app tells the framework. The board is one page with no
// request to read, so the build writes it to a file and the server serves the
// file.

export default {
  appDir: 'app',

  // Its own port, so it can run beside the showcase and the site.
  port: 1972,

  stylesheet: 'app/styles/global.css',

  // Nothing here inlines a script, and the policy costs nothing to leave on.
  csp: true,
};
