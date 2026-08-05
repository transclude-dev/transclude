// Facts about HTML that both compiler passes need.
//
// These are the spec's, not this codebase's, so they belong in one place and
// never change for a reason either pass would know about. Both lists were
// written out twice, in codegen.js and bind.js, and agreed by luck.

/** Elements with no closing tag and no children. */
export const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/**
 * Elements whose text is not entity-decoded by the parser, so escaping it would
 * change what the browser reads. `&amp;` is one character in prose and five in
 * JavaScript.
 */
export const RAW_TEXT = new Set(['script', 'style']);

/** parse5 hands back decoded text, so static output has to be re-encoded. */
export function escapeText(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

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
export function escapeAttr(value) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
