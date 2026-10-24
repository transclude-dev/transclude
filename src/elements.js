// Where an app's elements are: one directory, or several.
//
// One is the usual case and the default, `app/elements/`. Several is for an
// element more than one app uses, such as a package of shared elements read
// as well as the app's own. Each is a path from `appDir`, as `elementsDir`
// always was, and a path may leave it: `../../packages/kit/elements`.
//
// Three readers need the same answer, and each used to resolve the one string
// itself: the plugin finds an element by its tag, the checker decides by path
// which files are elements, and the dev server decides which edits change
// types. A directory one of them knew and another did not would compile an
// element the checker read as a page.

import path from 'node:path';

/**
 * Every element directory, absolute, in the order the config names them.
 *
 * @param {string} app the app directory, absolute
 * @param {string|string[]} elementsDir as the config has it
 * @returns {string[]}
 */
export function elementDirs(app, elementsDir) {
  const named = Array.isArray(elementsDir) ? elementsDir : [elementsDir];
  return [...new Set(named.map((dir) => path.resolve(app, dir)))];
}

/**
 * Whether a file sits in one of the element directories.
 *
 * With the separator, so `elements-old/` is not taken for `elements/`.
 *
 * @param {string} file absolute
 * @param {string[]} dirs from `elementDirs`
 * @returns {boolean}
 */
export function inElementDirs(file, dirs) {
  return dirs.some((dir) => file.startsWith(dir + path.sep));
}

/**
 * The directories as the config wrote them, for a message.
 *
 * @param {string|string[]} elementsDir
 * @returns {string}
 */
export function namedElementDirs(elementsDir) {
  return (Array.isArray(elementsDir) ? elementsDir : [elementsDir]).join(', ');
}
