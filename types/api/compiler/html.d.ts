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
