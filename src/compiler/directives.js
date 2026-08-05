// What a directive value means. One answer, because three files ask.
//
// `each` was parsed by the same regular expression written out in bind.js,
// codegen.js and shim.js. Three copies of one rule is three places to change and
// two to forget, and the three do different things with the answer: one emits a
// loop, one emits a binding, one emits the JS tsc checks. They agreed by luck.

/**
 * `item of items`, or `item, i of items`.
 *
 * The value is an expression, not an interpolation: there is no `${}` in it. A
 * parser that treated it as one would read the whole thing as text and get the
 * volatile set wrong, which is a silent bug rather than a loud one.
 */
const EACH = /^\s*([A-Za-z_$][\w$]*)\s*(?:,\s*([A-Za-z_$][\w$]*)\s*)?\s+of\s+([\s\S]+?)\s*$/;

/**
 * The three parts of an `each`, or null when it does not parse.
 *
 * @param {string} value the attribute as written
 * @returns {{ item: string, index: string|null, list: string }|null}
 */
export function parseEach(value) {
  const found = EACH.exec(value ?? '');
  if (!found) return null;

  const [, item, index, list] = found;
  return { item, index: index ?? null, list };
}
