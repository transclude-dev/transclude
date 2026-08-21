// Finishing what is in flight when the platform says stop.
//
// A container sends SIGTERM and waits a moment before SIGKILL. Node's default
// for SIGTERM is to die on the spot, so a render halfway through its loader
// answers nobody, and an action may have happened with its response cut on the
// wire. Draining instead refuses new connections, finishes what is running,
// and leaves.
//
// No imports. `process` and the timers are globals, and the server arrives as
// an argument.

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
export function drainOn(server, options = {}) {
  const {
    signals = ['SIGTERM', 'SIGINT'],
    grace = 10_000,
    sweep = 500,
    exit = (code) => process.exit(code),
  } = options;

  // The cap and the close both want to be the exit. First one wins.
  let left = false;
  const leave = (code) => {
    if (left) return;
    left = true;
    exit(code);
  };

  const drain = () => {
    const idle = setInterval(() => server.closeIdleConnections?.(), sweep);
    idle.unref?.();

    const cap = setTimeout(() => {
      server.closeAllConnections?.();
      leave(1);
    }, grace);
    cap.unref?.();

    server.close(() => {
      clearInterval(idle);
      clearTimeout(cap);
      leave(0);
    });
    server.closeIdleConnections?.();
  };

  for (const signal of signals) process.once(signal, drain);
  return drain;
}
