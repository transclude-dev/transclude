// The resolution trace: every hop this page made to render itself.
//
// It exists because an answer is only as trustworthy as the path to it. A
// record view that will not say which PDS served it, or that it read a DID
// document cached four minutes ago, is asking to be believed. This one shows
// the work.
//
// Every network function takes a trace and records into it. That is the whole
// contract, and it is why the trace is built now rather than added to the page
// later: retrofitting it means editing every call site anyway.

/**
 * @typedef {'hit'|'miss'|'none'} CacheState
 */

/**
 * @typedef {object} Hop
 * @property {string} label  What was asked. "DNS", "PLC directory", "PDS".
 * @property {string} detail  The address it was asked at.
 * @property {number} ms
 * @property {CacheState} cache
 * @property {boolean} ok
 * @property {string|null} note  A failure message.
 */

/**
 * @typedef {object} Trace
 * @property {Hop[]} hops
 * @property {<T>(label: string, detail: string, fn: () => Promise<{ value: T, cache: CacheState }>) => Promise<T>} step
 */

/**
 * A trace is per-request. It is passed down rather than reached for, so nothing
 * here is module state and two requests never share one.
 *
 * The function a step wraps returns `{ value, cache }` rather than a bare
 * value. One shape for every hop, cached or not, so the step never has to guess
 * what it was handed.
 *
 * @returns {Trace}
 */
export function createTrace() {
  /** @type {Hop[]} */
  const hops = [];

  return {
    hops,

    async step(label, detail, fn) {
      const started = performance.now();
      try {
        const { value, cache } = await fn();
        hops.push({ label, detail, ms: elapsed(started), cache, ok: true, note: null });
        return value;
      } catch (error) {
        // A failed hop is the most useful line in the trace, so it is recorded
        // and then rethrown. The page above decides what to show.
        const note = error instanceof Error ? error.message : String(error);
        hops.push({ label, detail, ms: elapsed(started), cache: 'none', ok: false, note });
        throw error;
      }
    },
  };
}

const elapsed = (started) => Math.round(performance.now() - started);

/** Total time across every hop. The number the trace rail shows at the top. */
export const traceMs = (trace) => trace.hops.reduce((total, hop) => total + hop.ms, 0);

/** A hop nothing caches. Wraps a bare value in the shape `step` expects. */
export const uncached = async (fn) => ({ value: await fn(), cache: /** @type {CacheState} */ ('none') });
