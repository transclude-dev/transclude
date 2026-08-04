// A session needs one thing from the config, and it is the important one.

export default {
  appDir: 'app',
  port: 1967,
  stylesheet: 'app/styles/global.css',
  csp: true,

  // Signs cookies. Without one, `ctx.cookies.signed` throws rather than quietly
  // writing an unsigned cookie, because a signature nobody checks is worse than
  // none: the browser could set `session=1` and be somebody else.
  //
  // `globalThis.process?.env`, not `process.env`. This file is read by every
  // runtime, and a bare reference is a ReferenceError on one with no Node
  // compatibility, before anything has a chance to run.
  cookieSecret: globalThis.process?.env?.COOKIE_SECRET ?? null,
};
