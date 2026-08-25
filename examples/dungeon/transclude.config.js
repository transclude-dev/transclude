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

  // A `<script type="speculationrules">` block on every page, so the room behind
  // a link is fetched while the reader is still deciding. The browser reads it
  // as data and runs no code of ours, which is why it is here and htmx is not.
  //
  // Every room is a server render, so the build puts them all in `prefetch` and
  // none in `prerender`: prerendering a URL runs its loader for a reader who
  // only hovered. That is the right split here for a second reason. A room is
  // one row of a table this app does not keep, and hovering an exit should not
  // be a move.
  speculate: true,
};
