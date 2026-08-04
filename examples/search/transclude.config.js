// A page whose results are a fragment, so the same markup answers a full
// request and a swap.

export default {
  appDir: 'app',
  port: 1964,
  stylesheet: 'app/styles/global.css',

  // The one script this app ships is a block in the page, and the policy hashes
  // it. Nothing has to be stamped at request time.
  csp: true,
};
