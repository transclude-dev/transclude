/**
 * A source map v3 for a file whose generated lines are known to come from
 * particular source lines.
 *
 * `lines` is one entry per generated line, counting from zero: the 1-based
 * source line it came from, or null for a line the compiler wrote itself, which
 * is most of the module. A null contributes no mapping at all rather than a
 * wrong one, so a stack in generated scaffolding stays honest about being
 * there.
 *
 * @param {(number|null)[]} lines
 * @param {string} source the `.html` file's path, as it should appear to a tool
 * @param {string} content the file's text, embedded so nothing has to find it
 * @returns {string} JSON
 */
export declare function sourceMap(lines: (number | null)[], source: string, content: string): string;
/**
 * The map as a comment a runtime will read, for appending to the module.
 *
 * @param {string} json
 * @returns {string}
 */
export declare function inlineMap(json: string): string;
/**
 * Where a block landed in the assembled module.
 *
 * The assemblers build one template literal, so rather than restructuring them
 * the block is written with a marker above it. This finds the marker, counts the
 * lines before it, and hands back the module without it.
 *
 * @param {string} code the assembled module, markers and all
 * @param {Array<{ marker: string, at: (number|null)[] }>} blocks
 * @returns {{ code: string, lines: (number|null)[] }}
 */
export declare function lineMap(code: string, blocks: Array<{
    marker: string;
    at: (number | null)[];
}>): {
    code: string;
    lines: (number | null)[];
};
