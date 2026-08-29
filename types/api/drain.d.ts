/**
 * Exit cleanly on a stop signal, once the work in flight is done.
 *
 * `close` stops the listener and waits for every open connection. A keep-alive
 * connection counts as open with no request on it, so idle ones are swept
 * while the close waits; without the sweep, the first browser that ever
 * connected would hold the wait to the cap. The cap is for a render that
 * hangs: past it, every connection is cut and the exit code says the drain was
 * not clean. Both timers are unref'd, so neither keeps a finished process
 * alive.
 *
 * @param {object} server what `serve` returned: a `node:http` server
 * @param {{ signals?: string[], grace?: number, sweep?: number, exit?: Function }} [options]
 * @returns {() => void} the drain itself, so a test can run one without a signal
 */
export declare function drainOn(server: object, options?: {
    signals?: string[];
    grace?: number;
    sweep?: number;
    exit?: Function;
}): () => void;
