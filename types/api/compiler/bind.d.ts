/**
 * @param {object[]} nodes the same parse5 nodes the renderer walked
 * @param {object} [opts]
 * @returns {{ locate: string, writes: string, cursors: object, parts: string,
 *   volatile: string[] }} `volatile` is what it could not bind, which is what
 *   decides whether a light element may update in place
 */
export declare function compileBindings(nodes: object[], opts?: object): {
    locate: string;
    writes: string;
    cursors: object;
    parts: string;
    volatile: string[];
};
