export declare const GLOBALS: Set<string>;
/**
 * The names in scope at a point in the template, innermost first.
 *
 * A name a scope holds is a loop variable or a block binding and compiles to
 * itself. Anything else is a field of the page's data and compiles to a lookup,
 * which is what makes `${title}` mean `__d.title` with nothing declared.
 */
export declare class Scope {
    parent: any;
    vars: Map<any, any>;
    constructor(parent?: any);
    declare(name: any, js: any, shape: any): void;
    lookup(name: any): any;
}
/**
 * A template expression as an AST.
 *
 * Directive values are expressions, not interpolations: `each="tag of tags"` has
 * no `${}` around it, so it is parsed rather than split.
 *
 * @param {string} source
 * @returns {object} a jsep node
 * @throws on an empty or unparseable expression
 */
export declare function parseExpr(source: string): object;
/**
 * An AST back to JavaScript, with every free name resolved against `scope`.
 *
 * @param {object} node a jsep node
 * @param {Scope} scope
 * @returns {string} an expression, safe to place inside the generated render
 */
export declare function emit(node: object, scope: Scope): string;
export type Chain = {
    /**
     * what the path is rooted at
     */
    base: 'data' | 'scope';
    /**
     * the root's name
     */
    name: string;
    /**
     * the static segments read from it
     */
    path: string[];
    /**
     * false once a computed access ended the path
     */
    open: boolean;
    /**
     * the loop variable's element type, when known
     */
    shape?: object;
};
/**
 * @typedef {object} Chain
 * @property {'data'|'scope'} base what the path is rooted at
 * @property {string} name the root's name
 * @property {string[]} path the static segments read from it
 * @property {boolean} open false once a computed access ended the path
 * @property {object} [shape] the loop variable's element type, when known
 */
/**
 * The longest static property path rooted at template data or a loop variable,
 * or null when the root is something we cannot follow (a call result, a
 * literal). A computed access ends the path, so `a.b[i].c` gives `a.b`. Past `[i]`
 * there is no way to know what is being read.
 *
 * @param {object} node
 * @param {Scope} scope
 * @param {object[]} [computed] collects the subscript expressions, which are
 *   themselves reads and have to be walked separately
 * @returns {Chain|null}
 */
export declare function chainOf(node: object, scope: Scope, computed?: object[]): Chain | null;
/**
 * Every data or loop-variable path an expression reads.
 *
 * This is what decides which bindings are volatile, and so whether a light
 * element can write an update in place or needs a shadow root to rebuild.
 *
 * @param {object} node
 * @param {Scope} scope
 * @param {Chain[]} [out] accumulator, so a caller can collect across several
 * @returns {Chain[]} one entry per read, in the order they were found
 */
export declare function collectRefs(node: object, scope: Scope, out?: Chain[]): Chain[];
