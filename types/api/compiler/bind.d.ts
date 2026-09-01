export type ParsedNode = import('./html.js').ParsedNode;
/**
 * @param {ParsedNode[]} nodes the same parse5 nodes the renderer walked
 * @param {{ components?: Map<string, string>, shadowTags?: Set<string>,
 *   blockOf?: Map<ParsedNode, string>, anchoredOf?: Set<ParsedNode>,
 *   refs?: Map<string, string>, rootOffset?: number }} [opts]
 * @returns {{ locate: string, writes: string, cursors: number, parts: string,
 *   volatile: string[] }} `volatile` is what it could not bind, which is what
 *   decides whether a light element may update in place
 */
export declare function compileBindings(nodes: ParsedNode[], opts?: {
    components?: Map<string, string>;
    shadowTags?: Set<string>;
    blockOf?: Map<ParsedNode, string>;
    anchoredOf?: Set<ParsedNode>;
    refs?: Map<string, string>;
    rootOffset?: number;
}): {
    locate: string;
    writes: string;
    cursors: number;
    parts: string;
    volatile: string[];
};
