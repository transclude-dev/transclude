/**
 * The unstable module, or the refusal naming what moved.
 *
 * Exported for its test, which is the only way to falsify a failure that needs
 * a TypeScript that does not exist yet.
 *
 * @param {object|null} unstable what importing `typescript/unstable/sync` gave
 * @param {string} version the TypeScript that gave it
 * @returns {object} the module, once its shape holds
 * @throws when the subpath or a name this file drives is gone
 */
export declare function refuseMovedAPI(unstable: object | null, version: string): object;
/**
 * The checker, and everything it needs held in one closure.
 *
 * This is long and stays long: every helper below reads the language service,
 * the shim map or the resolved project, and handing each of them five arguments
 * instead would be more to read rather than less. It is a list of small named
 * functions, in this order:
 *
 *   the language service     host, install, sourceOf
 *   reading a type back      exportTypeOf, expand, resolveNames, and the four
 *                            `…TypeOf` shorthands
 *   finding the project      elementFiles, layoutFiles, ancestorsOf, chainFor
 *   what a shim is given     contextLiteral, endpointLiteral, mergeTypes
 *   building them            build, refresh
 *   what callers use         the returned object
 *
 * `build` is the one to read first. It compiles every shim in dependency order,
 * which is the only order that resolves: an element depends on nothing, a layout
 * on the layouts above it, a page on its whole chain.
 *
 * @param {{ root: string, appDir: string, routesDir: string, elementsDir: string,
 *   strict?: boolean, markdown?: ((source: string, file: string) => string)|null }} options
 * @returns {{ files: Function, sourceFor: Function, update: Function,
 *   rebuild: Function, check: Function, quickInfo: Function, describe: Function,
 *   dispose: Function }}
 */
export declare function createChecker({ root, appDir, elementsDir, routesDir, strict, markdown, }: {
    root: string;
    appDir: string;
    routesDir: string;
    elementsDir: string;
    strict?: boolean;
    markdown?: ((source: string, file: string) => string) | null;
}): {
    files: Function;
    sourceFor: Function;
    update: Function;
    rebuild: Function;
    check: Function;
    quickInfo: Function;
    describe: Function;
    dispose: Function;
};
/**
 * Diagnostics for one TypeScript file, compiled alone.
 *
 * The guard `bin/check.js` runs over the emitted transclude-env.d.ts, and what
 * `test/types.test.js` asserts against, so the two cannot disagree about what
 * the file is allowed to name. `skipLibCheck` is off on purpose: a .d.ts is
 * the one kind of file that flag skips, and with it on this guard checked
 * nothing at all. `types: []` keeps the compile to this file, so a project's
 * own `@types` failing to resolve does not read as our file being broken.
 *
 * @param {string} file an absolute path to a .ts or .d.ts on disk
 * @returns {Array<{ offset: number, message: string }>}
 */
export declare function checkAlone(file: string): Array<{
    offset: number;
    message: string;
}>;
/**
 * Line and column for an offset, for anything that reports to a human.
 *
 * @param {string} source
 * @param {number} offset
 * @returns {{ line: number, column: number }} both 1-based, for a message a reader can follow
 */
export declare function positionAt(source: string, offset: number): {
    line: number;
    column: number;
};
