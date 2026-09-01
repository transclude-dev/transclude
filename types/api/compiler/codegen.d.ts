export type ParsedNode = import('./html.js').ParsedNode;
/**
 * The inclusion element. Reserved: an app cannot define one in `elements/`,
 * because this is read before the component table is consulted.
 */
export declare const INCLUDE_TAG = "transclude";
export declare class CompileError extends Error {
    line: any;
    column: any;
    constructor(message: any, node: any);
}
/**
 * The source around a refusal, with a caret under it.
 *
 * A line number tells a reader where to look. A frame shows them, which is the
 * difference between reading an error and finding one. Two lines of lead-in,
 * because a tag that opens on the line above is the usual reason the line the
 * error names looks fine on its own.
 *
 * @param {string} source the file the error came from
 * @param {number} [line] 1-based, as parse5 counts
 * @param {number} [column] 1-based
 * @returns {string} the frame, or '' when there is no position to draw
 */
export declare function frameOf(source: string, line?: number, column?: number): string;
export type Lines = {
    body: number[];
    head: number[];
    title: number[];
    slots: Record<string, number[]>;
    regions: Record<string, number[]>;
};
export type Fragment = {
    /**
     * the render function's body
     */
    body: string;
    at: Lines;
    /**
     * every block's own function, as source
     */
    blockDefs: string;
    /**
     * the node that opened each block
     */
    blockOf: Map<ParsedNode, string>;
    /**
     * every block that got anchors
     */
    anchoredOf: Set<ParsedNode>;
    slots: Record<string, string>;
    /**
     * each `fragment` region's own render
     */
    regions: Record<string, string>;
    regionIncludes: {
        id: string;
        node: ParsedNode;
        within: string | null;
    }[];
    includes: {
        key: string;
        kind: string;
        where: string;
        id: string | false;
    }[];
    /**
     * slot names this level renders
     */
    consumed: string[];
    head: string;
    /**
     * kept apart so the innermost one wins outright
     */
    title: string;
    hasTitle: boolean;
    htmlAttrs: string | null;
    bodyAttrs: string | null;
    warnings: string[];
    /**
     * every field of the data the template names
     */
    reads: Set<string>;
    components: {
        tag: string;
        ref: string;
    }[];
};
/**
 * Where a `${}` in the emitted code came from, one source line per emitted line.
 *
 * @typedef {object} Lines
 * @property {number[]} body
 * @property {number[]} head
 * @property {number[]} title
 * @property {Record<string, number[]>} slots
 * @property {Record<string, number[]>} regions
 */
/**
 * One compiled template: every buffer the walk filled, and what it learned on
 * the way.
 *
 * `blockOf` and `anchoredOf` are read by the binding pass, which walks the same
 * tree again and has to agree with this one about which nodes got anchors.
 *
 * @typedef {object} Fragment
 * @property {string} body the render function's body
 * @property {Lines} at
 * @property {string} blockDefs every block's own function, as source
 * @property {Map<ParsedNode, string>} blockOf the node that opened each block
 * @property {Set<ParsedNode>} anchoredOf every block that got anchors
 * @property {Record<string, string>} slots
 * @property {Record<string, string>} regions each `fragment` region's own render
 * @property {{ id: string, node: ParsedNode, within: string|null }[]} regionIncludes
 * @property {{ key: string, kind: string, where: string, id: string|false }[]} includes
 * @property {string[]} consumed slot names this level renders
 * @property {string} head
 * @property {string} title kept apart so the innermost one wins outright
 * @property {boolean} hasTitle
 * @property {string|null} htmlAttrs
 * @property {string|null} bodyAttrs
 * @property {string[]} warnings
 * @property {Set<string>} reads every field of the data the template names
 * @property {{ tag: string, ref: string }[]} components
 */
/**
 * @param {ParsedNode[]} nodes
 * @param {{ components?: Map<string, string>, shadowTags?: Set<string>,
 *   page?: boolean, layout?: boolean, blocks?: boolean, fragments?: boolean,
 *   html?: ParsedNode|null, body?: ParsedNode|null }} [opts]
 * @returns {Fragment} the render body, the regions, the slots, the includes and
 *   the warnings
 */
export declare function compileFragment(nodes: ParsedNode[], opts?: {
    components?: Map<string, string>;
    shadowTags?: Set<string>;
    page?: boolean;
    layout?: boolean;
    blocks?: boolean;
    fragments?: boolean;
    html?: ParsedNode | null;
    body?: ParsedNode | null;
}): Fragment;
export declare const ANCHOR_OPEN = "<!--[-->";
export declare const ANCHOR_CLOSE = "<!--]-->";
/**
 * `else` / `else-if` bind to the `if` before them, so a chain is one unit. Both
 * passes have to agree on where it ends, so they share the same walk.
 *
 * @param {ParsedNode[]} nodes
 * @param {number} i where the `if` is
 * @returns {{ chain: Array<{ node: ParsedNode, kind: string, cond: string|null }>, next: number }|null}
 *   null when the element carries no `if`, so there is no chain to gather
 */
export declare function gatherChain(nodes: ParsedNode[], i: number): {
    chain: Array<{
        node: ParsedNode;
        kind: string;
        cond: string | null;
    }>;
    next: number;
} | null;
export declare function childrenOf(node: any): any;
