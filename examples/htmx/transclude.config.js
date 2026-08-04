// The one key this example exists for.

export default {
  appDir: 'app',
  port: 1965,
  stylesheet: 'app/styles/global.css',

  // htmx sends the id of the element it is about to swap in `HX-Target`. Naming
  // that header here means the header alone can ask for a region, so
  // `hx-get="/"` with `hx-target="#results"` needs no `?fragment=` on the URL.
  //
  // Off by default, and not out of squeamishness: a request that may vary by a
  // header has to say so, and this adds `HX-Target` to `Vary`. Widening a cache
  // key is a real cost for a feature an app may not use.
  //
  // The query parameter still works and still wins. It is the strict one: an
  // unknown name there is a 404, because somebody typed it. An unknown name in
  // the header is ignored, because htmx sends the header on every request,
  // including the ones that want a whole document.
  fragmentHeader: 'HX-Target',

  // `script-src 'self'`, which is why htmx is copied into app/public/ rather
  // than loaded from a CDN.
  csp: true,
};
