// Where the app is, and what it configured.
//
// The framework used to reach two directories up from its own file for both, and
// import `transclude.config.js` by relative path. That is only true while it sits
// inside the app it serves. Installed as a package it sits in node_modules, where
// two directories up is somebody else's package.
//
// So the root comes from where the command was run, and the config is loaded from
// there at run time. Nothing under `framework/` names a path in the app again.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const CONFIG_FILE = 'transclude.config.js';

/**
 * The port an app listens on when it does not name one.
 *
 * 3000 and 5173 are the two most crowded ports on a developer's machine, and a
 * server someone else started answering yours is a bad half hour. 1960 is the
 * year Project Xanadu began, which is where transclusion comes from.
 */
export const DEFAULT_PORT = 1960;

/**
 * `PORT` beats the config, so a host that assigns one is obeyed without an edit.
 * Dev and production share this, so an app has one port rather than two.
 *
 * @param {object} [config]
 * @param {string|undefined} [env] `PORT`, which wins
 * @returns {number}
 * @throws when the value is set but not a port
 */
export function portOf(config = {}, env = undefined) {
  const asked = env ?? config.port ?? DEFAULT_PORT;
  const port = Number(asked);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `[transclude] port must be a whole number from 1 to 65535, not ${JSON.stringify(asked)}`,
    );
  }
  return port;
}

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
export function findRoot(from = process.cwd()) {
  let dir = path.resolve(from);

  for (;;) {
    if (fs.existsSync(path.join(dir, CONFIG_FILE))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }

  throw new Error(
    `[transclude] no ${CONFIG_FILE} in ${path.resolve(from)} or any directory above it`,
  );
}

/**
 * The root and its config together, because nothing needs one without the other.
 *
 * Imported by URL rather than by path: a space in the project path stays
 * percent-encoded in a bare file path and `Atelier%20Dakroub` is not a directory.
 *
 * @param {string} [from]
 * @returns {Promise<object>} the root, the config and every resolved directory
 */
export async function loadProject(from = process.cwd()) {
  const root = findRoot(from);
  const file = path.join(root, CONFIG_FILE);
  const { default: config } = await import(pathToFileURL(file).href);

  if (!config || typeof config !== 'object') {
    throw new Error(`[transclude] ${CONFIG_FILE} must export a config object as its default`);
  }
  assertNoSplitDirs(config, file);
  return { root, config, configFile: file };
}

/**
 * `partialsDir` and `componentsDir` are one `elementsDir` now, and how an
 * element renders is read from the file rather than from where it sits.
 *
 * Left alone, the old keys would be ignored and the app would look in
 * `app/elements/`, find nothing, and every tag would render as an unknown
 * element with no styles and nothing said.
 */
function assertNoSplitDirs(config, file) {
  const old = ['partialsDir', 'componentsDir'].filter((key) => key in config);
  if (!old.length) return;

  throw new Error(
    `[transclude] ${file} sets ${old.join(' and ')}, which nothing reads. ` +
      `Put every element in one directory and name it with \`elementsDir\`. ` +
      `A shadow root is opt-in per file now: \`export const shadow = true\`.`,
  );
}
