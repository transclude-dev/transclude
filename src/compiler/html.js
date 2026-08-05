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
