export declare const CONFIG_FILE = "transclude.config.js";
/**
 * The port an app listens on when it does not name one.
 *
 * 3000 and 5173 are the two most crowded ports on a developer's machine, and a
 * server someone else started answering yours is a bad half hour. 1960 is the
 * year Project Xanadu began, which is where transclusion comes from.
 */
export declare const DEFAULT_PORT = 1960;
/**
 * `PORT` beats the config, so a host that assigns one is obeyed without an edit.
 * Dev and production share this, so an app has one port rather than two.
 *
 * @param {object} [config]
 * @param {string|undefined} [env] `PORT`, which wins
 * @returns {number}
 * @throws when the value is set but not a port
 */
export declare function portOf(config?: object, env?: string | undefined): number;
/**
 * The nearest directory at or above `from` holding the config file.
 *
 * npm runs a script with the package root as the working directory, so the
 * search almost always ends at the first try. It walks up so that running a bin
 * by hand from a subdirectory works too.
 *
 * @param {string} [from]
 * @returns {string} the directory holding transclude.config.js
 */
export declare function findRoot(from?: string): string;
/**
 * What a config means when it says nothing.
 *
 * These were documented as defaults and were not applied anywhere: `loadProject`
 * handed the object back as written, so a config that left `outDir` out reached
 * `path.join(root, undefined)` and threw `ERR_INVALID_ARG_TYPE`, which names
 * neither the key nor the file. The starter templates set every one of them,
 * which is why nothing caught it.
 *
 * `port` is not here. `portOf` already answers it, and it reads the environment
 * first, which a plain default cannot do.
 *
 * They live in `defaults.js` rather than here, because a worker has no
 * `loadProject` and needs the same answers. `createApp` applies them for every
 * runtime, and this file is only Node's way in.
 */
/**
 * The root and its config together, because nothing needs one without the other.
 *
 * Imported by URL rather than by path: a space in the project path stays
 * percent-encoded in a bare file path and `Atelier%20Dakroub` is not a directory.
 *
 * @param {string} [from]
 * @returns {Promise<{ root: string, config: import('./defaults.js').Config,
 *   configFile: string }>} the root, the config and the file it came from
 */
export declare function loadProject(from?: string): Promise<{
    root: string;
    config: import('./defaults.js').Config;
    configFile: string;
}>;
