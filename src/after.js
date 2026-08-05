// Work that outlives the response.
//
// Every runtime here keeps a promise running after a response, except the one
// that matters most for this. Node, Bun and Deno are processes, and a promise
// nobody awaits finishes on its own. workerd is not: the isolate is allowed to
// stop once the response is sent, and anything still running stops with it.
// `waitUntil` is how a worker asks to stay up, and it exists nowhere else.
//
// So `ctx.after` is a capability rather than a runtime's API. It means the same
// thing on all four: this work does not have to finish before the reader is
// served. That is the bar `env` failed, which is why there is no `ctx.env`.
//
// No `node:` imports.

/**
 * The runtime's `ExecutionContext`, or null when it has none.
 *
 * Hono's getter throws rather than answering undefined, so the only way to ask
 * is to try. The `try` covers the getter and nothing else: a `waitUntil` that
 * throws is a real failure and belongs to the caller.
 *
 * @param {object} c a Hono context
 * @returns {{ waitUntil: (work: Promise<unknown>) => void }|null}
 */
export function executionCtxOf(c) {
  try {
    return c.executionCtx;
  } catch {
    return null;
  }
}

/**
 * `ctx.after` for one request.
 *
 * The rejection handling is the reason this is not one line at the call site.
 * Nothing is awaiting this work, so a throw inside it reaches the runtime's
 * unhandled rejection handler, which on Node ends the process. It goes to the
 * same place a failed request goes instead, with the request that started it.
 *
 * `report` is called with the error alone. Whoever builds this already knows
 * which request it belongs to.
 *
 * @param {object} c a Hono context
 * @param {(error: unknown) => void} report where a failure goes
 * @returns {(work: Promise<unknown>) => void}
 */
export function afterFor(c, report) {
  return (work) => {
    // A function is the mistake worth naming. `after(() => log())` would be
    // wrapped by `Promise.resolve`, resolve to the function itself, and do
    // nothing at all, which is the one shape that fails without a symptom.
    if (typeof work?.then !== 'function') {
      throw new TypeError(
        '[transclude] ctx.after takes a promise. Call the work and pass what it ' +
          'returns, as in `after(log(url))` rather than `after(() => log(url))`.',
      );
    }

    const settled = Promise.resolve(work).catch(report);

    // Only workerd has one. Everywhere else the promise is already running and
    // the process is still there to finish it.
    const execution = executionCtxOf(c);
    if (execution) execution.waitUntil(settled);
  };
}
