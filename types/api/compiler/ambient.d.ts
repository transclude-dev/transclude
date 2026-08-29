/**
 * Each entry is one type, written the way TypeScript spells it. `params` are the
 * type parameters, which JSDoc writes as `@template` and a `.d.ts` writes in
 * angle brackets.
 */
export declare const AMBIENT: {
    name: string;
    params: string[];
    text: string;
}[];
export declare const AMBIENT_NAMES: Set<string>;
/**
 * The JSDoc a shim carries for the given names. A name JSDoc cannot resolve is
 * `any` rather than an error, so a shim that names one of these without this is
 * checking nothing and saying so nowhere.
 *
 * @param {string[]} names
 * @returns {string}
 */
export declare function ambientJsdoc(names: string[]): string;
/**
 * The same types as TypeScript declarations, for the emitted file. Only the ones
 * it mentions: an unused type in a generated file is noise.
 *
 * @param {string} body what the file says so far
 * @param {(type: string) => string} [format] how to lay a type out
 * @returns {string[]} the lines to put above it
 */
export declare function ambientDeclarations(body: string, format?: (type: string) => string): string[];
