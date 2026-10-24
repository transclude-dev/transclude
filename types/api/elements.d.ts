/**
 * Every element directory, absolute, in the order the config names them.
 *
 * @param {string} app the app directory, absolute
 * @param {string|string[]} elementsDir as the config has it
 * @returns {string[]}
 */
export declare function elementDirs(app: string, elementsDir: string | string[]): string[];
/**
 * Whether a file sits in one of the element directories.
 *
 * With the separator, so `elements-old/` is not taken for `elements/`.
 *
 * @param {string} file absolute
 * @param {string[]} dirs from `elementDirs`
 * @returns {boolean}
 */
export declare function inElementDirs(file: string, dirs: string[]): boolean;
/**
 * The directories as the config wrote them, for a message.
 *
 * @param {string|string[]} elementsDir
 * @returns {string}
 */
export declare function namedElementDirs(elementsDir: string | string[]): string;
