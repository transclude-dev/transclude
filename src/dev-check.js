// Type checking while you work.
//
// `transclude-check` is the command, and it is the one that fails a build. This
// is the same checker reporting in the background, because a type error nothing
// mentions until CI is one you wrote twenty edits ago. It never blocks a render.
// The page compiles, the server sends it, and this prints beside it.
//
// It says something on every run, a clean one included. A checker that prints
// only on failure makes "passed" and "never ran" look identical, which is the
// whole subject of /blog/no-output-looks-like-good-output.
//
// It writes no `transclude-env.d.ts`. That file is `transclude-check`'s to
// write, and writing it here would land inside `appDir`, wake the watcher and
// schedule the run that wrote it.
//
// Measured on the showcase: 92ms to start the compiler, 100ms for a pass over
// 22 files, 29ms to rebuild, and 26ms for the slowest single file. Cheap enough
// to run on a keystroke, and the yield between files is what keeps that slowest
// file from sitting in front of a request.

import { reportFor, summarize } from './diagnostics.js';

/**
 * The checker, or null when TypeScript is not installed.
 *
 * An optional peer that nothing installed is a normal state rather than a
 * broken one, so this answers null and the caller says so in one line. Loading
 * it any earlier would make the resolver's own words the error, and those name
 * a package the author never wrote.
 *
 * @returns {Promise<{ createChecker: typeof import('./typecheck.js').createChecker,
 *   positionAt: typeof import('./typecheck.js').positionAt }|null>}
 */
export async function loadTypecheck() {
  try {
    const { createChecker, positionAt } = await import('./typecheck.js');
    return { createChecker, positionAt };
  } catch (err) {
    const missing =
      err?.code === 'ERR_MODULE_NOT_FOUND' && /'typescript(\/|')/.test(err.message ?? '');
    if (missing) return null;
    throw err;
  }
}

/**
 * A background reporter over a checker.
 *
 * `schedule` coalesces: a burst of saves runs once, and a save during a run
 * queues exactly one more rather than one per file. `rebuild` is sticky across
 * a coalesced burst, because adding a file and then editing it must not lose
 * the add.
 *
 * @param {{ checker: Pick<import('./typecheck.js').Checker,
 *   'files' | 'check' | 'sourceFor' | 'rebuild'>,
 *   root: string,
 *   positionAt: (source: string, offset: number) => { line: number, column: number },
 *   isMarkdown: (f: string) => boolean,
 *   log?: (line: string) => void, delay?: number }} deps
 */
export function typeReporter({
  checker,
  root,
  positionAt,
  isMarkdown,
  log = console.log,
  delay = 250,
}) {
  let timer = null;
  let running = false;
  let queued = false;
  let rebuild = false;

  async function pass() {
    if (rebuild) {
      checker.rebuild();
      rebuild = false;
    }

    const files = checker.files();
    let errors = 0;
    let warnings = 0;

    for (const file of files) {
      // One file per turn of the loop. Nothing here is async, and a dev server
      // answering a request in the middle of a pass is worth the yields.
      await Promise.resolve();

      const diagnostics = checker.check(file);
      if (!diagnostics.length) continue;

      const report = reportFor(file, diagnostics, {
        root,
        source: checker.sourceFor(file),
        converted: isMarkdown(file),
        positionAt,
      });
      errors += report.errors;
      warnings += report.warnings;
      log(report.lines.join('\n'));
    }

    log(`[types] ${summarize({ errors, warnings, files: files.length })}`);
    return { errors, warnings, files: files.length };
  }

  async function drain() {
    running = true;
    try {
      do {
        queued = false;
        await pass();
      } while (queued);
    } finally {
      running = false;
    }
  }

  return {
    /**
     * Asks for a run. `rebuild` for a file added, renamed or removed, because
     * the type of every other page can depend on it.
     *
     * @param {{ rebuild?: boolean }} [options]
     */
    schedule({ rebuild: needsRebuild = false } = {}) {
      if (needsRebuild) rebuild = true;
      if (running) {
        queued = true;
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(() => {
        drain().catch((err) => log(`[types] ${err.message}`));
      }, delay);
      // Nothing should wait on this. An unref'd timer lets a process that is
      // otherwise done exit rather than sitting on a pending check.
      timer.unref?.();
    },

    /** One pass now, awaited. The startup run and every test go through this. */
    run: () => drain(),
  };
}
