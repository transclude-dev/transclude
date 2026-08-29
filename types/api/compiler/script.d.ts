export declare class ScriptError extends Error {
    constructor(message: any);
}
/**
 * Rewrites `export default <thing>` to `const <name> = <thing>` in place,
 * leaving imports and named exports exactly where the author put them.
 * Returns the exported names so callers can check them against the names the
 * generated module already uses.
 *
 * @param {{ code: string, line?: number }} block
 * @param {string} name what to bind the default export to
 * @param {string} label for an error
 * @returns {{ code: string, exports: string[],
 *   imports: Array<{ source: string, specifiers: string }>,
 *   declared: string[], defaultNode: object|null }}
 */
export declare function bindDefaultExport(block: {
    code: string;
    line?: number;
}, name: string, label: string): {
    code: string;
    exports: string[];
    imports: Array<{
        source: string;
        specifiers: string;
    }>;
    declared: string[];
    defaultNode: object | null;
};
/**
 * The names `<script element>` declares, and what the generated module calls
 * each one. Every other export is refused: this block is read by name, so a
 * name nobody reads is a typo the author should hear about rather than a value
 * that quietly does nothing.
 */
export declare const ELEMENT_BINDINGS: {
    properties: string;
    state: string;
    prototype: string;
    attributes: string;
};
/**
 * What an element declares about the tag rather than about one element. Each is
 * the same for every element of it, so each has to be a literal: a computed
 * value would look like a per-element choice and could not be one.
 */
export declare const ELEMENT_FLAGS: string[];
/**
 * Reads `<script element>`: a module whose reserved exports are rebound to the
 * names the generated module uses, and whose flags are read out as literals.
 *
 * Every splice keeps the block's own length, padding with spaces, so a line and
 * column in the generated module is the line and column in the .html file. Only
 * the reserved names move. Imports, helpers, typedefs and anything else the
 * author wrote stay exactly where they were written, which is the whole point
 * of the block being a real module.
 *
 * @param {{ code: string, line?: number }} block
 * @param {string} label for an error
 * @returns {{ code: string, nodes: Record<string, object|null>, flags: object,
 *   imports: Array<object>, declared: string[], warnings: string[] }}
 */
export declare function bindElementModule(block: {
    code: string;
    line?: number;
}, label: string): {
    code: string;
    nodes: Record<string, object | null>;
    flags: object;
    imports: Array<object>;
    declared: string[];
    warnings: string[];
};
/**
 * Module-level client code (a page entry) only needs validating.
 *
 * @param {Array<{ code: string, line?: number }>} blocks
 * @param {string} label
 * @returns {void}
 * @throws with the offset mapped back to the .html file
 */
export declare function assertModule(blocks: Array<{
    code: string;
    line?: number;
}>, label: string): void;
/**
 * Guards against a block using a name the generated module already defines.
 *
 * @param {string[]} names
 * @param {Set<string>} reserved
 * @param {string} label
 * @param {string} [verb] how the block used it, for the message
 * @returns {void}
 * @throws naming the first collision
 */
export declare function assertNoCollisions(names: string[], reserved: Set<string>, label: string, verb?: string): void;
/**
 * A page's handlers are verb exports. An `actions` object is what they used to
 * be, and nothing reads one now, so leaving it would answer 405 to every form
 * on the page and say nothing about why.
 *
 * @param {string[]} exports
 * @param {string} label
 * @returns {void}
 * @throws because nothing reads one, so a page keeping it would 405 in silence
 */
export declare function assertNoActionsObject(exports: string[], label: string): void;
