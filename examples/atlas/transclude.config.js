export default {
  appDir: 'app',
  routesDir: 'routes',
  elementsDir: 'elements',
  stylesheet: 'app/styles/global.css',

  port: 1971,

  // Every record view is a fragment other sites can ask for on its own. That is
  // what this app is for, so the parameter is named rather than left to the
  // default, and `watchElements` stays off: nothing here swaps markup into a
  // live page, so no page needs to carry the script that would notice.
  fragmentParam: 'fragment',
  watchElements: false,

  trailingSlash: 'never',

  outDir: 'dist',
  typesFile: 'app/transclude-env.d.ts',
};
