export type Chunk = {
    start: number;
    text: string;
    source: number | null;
    pinned?: boolean;
};
/**
 * Maps an offset in the shim back to an offset in the .html file, or null when
 * it landed in generated scaffolding.
 *
 * One run of shim text, and where in the .html file it came from.
 *
 * `source` is null for text the Builder wrote itself, which is what makes a
 * diagnostic landing there unmappable. `pinned` means every offset in the run
 * maps to one source position rather than moving with it.
 *
 * @typedef {{ start: number, text: string, source: number|null,
 *   pinned?: boolean }} Chunk
 *
 * @param {Chunk[]} chunks what the Builder recorded
 * @param {number} offset into the shim
 * @returns {number|null} the offset in the .html file, or null when it does not map
 */
export declare function originalOffset(chunks: Chunk[], offset: number): number | null;
/**
 * An endpoint is already a module. There is nothing to compile, only something to
 * annotate. So the shim is the file, verbatim, with a `@satisfies` spliced in
 * front of each verb export.
 *
 * That buys two things a page's shim also buys: the handler's own `ctx` is typed
 * from the route context rather than being an implicit `any`, and the return type
 * is held to `Response`, which is the one rule an endpoint has.
 *
 * Copied with offsets like every other shim, so a diagnostic points at the real
 * line in the real file.
 *
 * @param {string} source
 * @param {{ contextType: string }} options
 * @returns {{ code: string, chunks: object[], syntaxErrors: object[] }}
 */
export declare function buildEndpointShim(source: string, { contextType }: {
    contextType: string;
}): {
    code: string;
    chunks: object[];
    syntaxErrors: object[];
};
/**
 * `page`, `layout` and `component` differ only in where their data comes from:
 * a loader checked against a route context, or a props object.
 *
 * @param {string} source
 * @param {{ kind: string, shadow?: boolean, contextType?: string|null,
 *   componentProps?: Map<string, string> }} options
 * @returns {{ code: string, chunks: object[], syntaxErrors: object[] }}
 */
export declare function buildShim(source: string, { kind, shadow, contextType, componentProps }: {
    kind: string;
    shadow?: boolean;
    contextType?: string | null;
    componentProps?: Map<string, string>;
}): {
    code: string;
    chunks: object[];
    syntaxErrors: object[];
};
