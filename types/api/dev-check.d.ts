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
export declare function loadTypecheck(): Promise<{
    createChecker: typeof import('./typecheck.js').createChecker;
    positionAt: typeof import('./typecheck.js').positionAt;
} | null>;
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
export declare function typeReporter({ checker, root, positionAt, isMarkdown, log, delay, }: {
    checker: Pick<import('./typecheck.js').Checker, 'files' | 'check' | 'sourceFor' | 'rebuild'>;
    root: string;
    positionAt: (source: string, offset: number) => {
        line: number;
        column: number;
    };
    isMarkdown: (f: string) => boolean;
    log?: (line: string) => void;
    delay?: number;
}): {
    /**
     * Asks for a run. `rebuild` for a file added, renamed or removed, because
     * the type of every other page can depend on it.
     *
     * @param {{ rebuild?: boolean }} [options]
     */
    schedule({ rebuild: needsRebuild }?: {
        rebuild?: boolean;
    }): void;
    /** One pass now, awaited. The startup run and every test go through this. */
    run: () => Promise<void>;
};
