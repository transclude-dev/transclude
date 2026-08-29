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
export declare function executionCtxOf(c: object): {
    waitUntil: (work: Promise<unknown>) => void;
} | null;
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
export declare function afterFor(c: object, report: (error: unknown) => void): (work: Promise<unknown>) => void;
