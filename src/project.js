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
 * The nearest directory at or above `from` holding the config file.
 *
 * npm runs a script with the package root as the working directory, so the
 * search almost always ends at the first try. It walks up so that running a bin
 * by hand from a subdirectory works too.
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
 */
export async function loadProject(from = process.cwd()) {
  const root = findRoot(from);
  const file = path.join(root, CONFIG_FILE);
  const { default: config } = await import(pathToFileURL(file).href);

  if (!config || typeof config !== 'object') {
    throw new Error(`[transclude] ${CONFIG_FILE} must export a config object as its default`);
  }
  return { root, config, configFile: file };
}
