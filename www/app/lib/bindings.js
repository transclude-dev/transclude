// What `worker.js` was handed, for the loaders that need it.
//
// `ctx` has no `env`, on purpose: `env` means something different on each of the
// four runtimes, so the framework names none of them. `worker.js` belongs to
// this site and does get it, which is why the bridge lives here. See
// /docs/runtimes.
//
// Nothing from `node:`. A loader importing this puts it in the bundle workerd
// loads, and `www/test/worker.test.js` fails the build if it ever does.
//
// Module scope is safe for this and not for a request. `env` is one object for
// the life of the isolate, so every request in it gets the same one. Holding a
// `Request` here would hand one visitor's to the next.

// Held on `globalThis` rather than in a module variable, and the reason is not
// style. Two bundlers touch this file. Vite compiles the loaders into
// `dist/server/entry.js` and inlines a copy of this module into it; wrangler
// then bundles `worker.js`, which imports this file again and gets a second
// copy. `hold` wrote to one and `bindings` read the other, so the loader saw
// null, fell through to the in-memory fallback, and every signup on the live
// site went into a Map instead of D1. The form worked, the page said "check
// your inbox", and the table stayed empty.
//
// A symbol in the global registry is one slot per isolate no matter how many
// copies of this module exist.
const SLOT = Symbol.for('transclude.www.bindings');

/** Called by `worker.js` on every request. Same object each time. */
export const hold = (env) => {
  globalThis[SLOT] = env;
};

/**
 * The bindings, or null anywhere that has none.
 *
 * Null rather than a throw, because this site runs on Node in dev and in every
 * test, and a page that cannot reach a database should say so rather than 500.
 * The callers are the ones that know what to do without it.
 *
 * @returns {Record<string, any>|null}
 */
export const bindings = () => globalThis[SLOT] ?? null;
