/**
 * The inclusion element. Reserved: an app cannot define one in `elements/`,
 * because this is read before the component table is consulted.
 */
export declare const INCLUDE_TAG = "transclude";
export declare class CompileError extends Error {
    line: any;
    constructor(message: any, node: any);
}
/**
 * @param {object[]} nodes
 * @param {object} [opts]
 * @returns {object} the render body, the regions, the slots, the includes and the warnings
 */
export declare function compileFragment(nodes: object[], opts?: object): object;
export declare const ANCHOR_OPEN = "<!--[-->";
export declare const ANCHOR_CLOSE = "<!--]-->";
/**
 * `else` / `else-if` bind to the `if` before them, so a chain is one unit. Both
 * passes have to agree on where it ends, so they share the same walk.
 *
 * @param {object[]} nodes
 * @param {number} i where the `if` is
 * @returns {{ chain: Array<{ node: object, kind: string, cond: string|null }>, next: number }|null}
 *   null when the element carries no `if`, so there is no chain to gather
 */
export declare function gatherChain(nodes: object[], i: number): {
    chain: Array<{
        node: object;
        kind: string;
        cond: string | null;
    }>;
    next: number;
} | null;
export declare function childrenOf(node: any): any;
