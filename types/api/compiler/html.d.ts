export type ParsedNode = {
    nodeName: string;
    tagName?: string;
    /**
     * text, and the body of a script or a style
     */
    value?: string;
    /**
     * a comment's text
     */
    data?: string;
    attrs?: {
        name: string;
        value: string;
    }[];
    childNodes?: ParsedNode[];
    /**
     * a template's children
     */
    content?: {
        childNodes?: ParsedNode[];
    };
    parentNode?: ParsedNode | null;
    sourceCodeLocation?: any;
};
/**
 * A parse5 node, as this compiler treats one.
 *
 * parse5's own types are a discriminated union, and every walk here reads
 * across it: `value` on a text node, `content` on a template, `attrs` on an
 * element, `data` on a comment, and `sourceCodeLocation` on whatever raised an
 * error. Naming the union would mean narrowing at each of those reads, in a
 * tree the walk already knows the shape of, so this is the permissive
 * spelling. Everything is optional and the compiler's own guards decide what is
 * there. Written here because three files walk the same tree.
 *
 * @typedef {object} ParsedNode
 * @property {string} nodeName
 * @property {string} [tagName]
 * @property {string} [value] text, and the body of a script or a style
 * @property {string} [data] a comment's text
 * @property {{ name: string, value: string }[]} [attrs]
 * @property {ParsedNode[]} [childNodes]
 * @property {{ childNodes?: ParsedNode[] }} [content] a template's children
 * @property {ParsedNode|null} [parentNode]
 * @property {any} [sourceCodeLocation]
 */
/** Elements with no closing tag and no children. */
export declare const VOID: Set<string>;
/**
 * Elements whose text is not entity-decoded by the parser, so escaping it would
 * change what the browser reads. `&amp;` is one character in prose and five in
 * JavaScript.
 */
export declare const RAW_TEXT: Set<string>;
/** parse5 hands back decoded text, so static output has to be re-encoded. */
export declare function escapeText(value: any): any;
/**
 * A static attribute value.
 *
 * Three characters, and `>` is deliberately not one of them: a quoted attribute
 * value may hold one, and leaving it is what a serializer does. That has a
 * consequence worth knowing, because `content="a > b"` then reaches the page
 * with a bare `>` in it, and anything scanning compiled markup for the end of a
 * tag has to be quote-aware rather than stopping at the first one. `mergeHead`
 * in document.js is that scanner, and it had this wrong once.
 *
 * The runtime escapes `>` as well, so an interpolated value and a static one
 * come out spelled differently and parse the same. That is not worth making
 * agree: the runtime ships to a browser and must not import from here.
 */
export declare function escapeAttr(value: any): any;
