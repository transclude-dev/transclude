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
export type AcornNode = {
    type: string;
    start?: number;
    end?: number;
    name?: string;
    id?: AcornNode;
    body?: AcornNode[];
    specifiers?: AcornNode[];
    declarations?: AcornNode[];
    declaration?: AcornNode;
    local?: AcornNode;
};
export type ElementModule = {
    /**
     * the block, with the reserved names rebound
     */
    code: string;
    nodes: {
        properties?: object | null;
        state?: object | null;
        prototype?: object | null;
        attributes?: object | null;
    };
    flags: {
        shadow?: boolean | null;
        formAssociated?: boolean | null;
    };
    imports: Array<object>;
    /**
     * everything else the block declared
     */
    declared: string[];
    warnings: string[];
};
/**
 * An acorn node, as this file treats one.
 *
 * acorn's types are a discriminated union and every walk here reads across it,
 * the way `ParsedNode` does for parse5. Permissive on purpose: the walk has
 * already established which kind it holds by the time it reads a field.
 *
 * @typedef {object} AcornNode
 * @property {string} type
 * @property {number} [start]
 * @property {number} [end]
 * @property {string} [name]
 * @property {AcornNode} [id]
 * @property {AcornNode[]} [body]
 * @property {AcornNode[]} [specifiers]
 * @property {AcornNode[]} [declarations]
 * @property {AcornNode} [declaration]
 * @property {AcornNode} [local]
 */
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
 * What `<script element>` declared.
 *
 * `nodes` is one acorn node per reserved export, so a later pass can read what
 * the author wrote rather than re-parse it. `flags` are the two that have to be
 * literals, because how a tag renders decides how every file that mentions it
 * compiles.
 *
 * @typedef {object} ElementModule
 * @property {string} code the block, with the reserved names rebound
 * @property {{ properties?: object|null, state?: object|null,
 *   prototype?: object|null, attributes?: object|null }} nodes
 * @property {{ shadow?: boolean|null, formAssociated?: boolean|null }} flags
 * @property {Array<object>} imports
 * @property {string[]} declared everything else the block declared
 * @property {string[]} warnings
 *
 * @param {{ code: string, line?: number }} block
 * @param {string} label for an error
 * @returns {ElementModule}
 */
export declare function bindElementModule(block: {
    code: string;
    line?: number;
}, label: string): ElementModule;
/**
 * Module-level client code (a page entry) only needs validating.
 *
 * @param {Array<{ code: string, line?: number }>} blocks
 * @param {string} label
 * @returns {string} the blocks, joined
 * @throws with the offset mapped back to the .html file
 */
export declare function assertModule(blocks: Array<{
    code: string;
    line?: number;
}>, label: string): string;
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
