/**
 * The frames of a stack that sit in one bundle, mapped to their sources.
 *
 * Only a frame whose generated line carries a mapping is returned. The source
 * index and line are running totals across the whole `mappings` string, so
 * every line is walked once, in order, whichever lines the stack asks about.
 *
 * @param {string} stack whatever `error.stack` holds
 * @param {string} bundle how the bundle is named in a frame, like `server/entry.js`
 * @param {{ sources: string[], mappings: string }} map the bundle's source map
 * @returns {Array<{ source: string, line: number }>} outermost frame first
 */
export declare function mappedFrames(stack: string, bundle: string, map: {
    sources: string[];
    mappings: string;
}): Array<{
    source: string;
    line: number;
}>;
