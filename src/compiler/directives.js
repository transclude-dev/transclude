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
 *
 * A name is a JavaScript identifier, so `café` is one. The `u` flag is what
 * lets `\p{ID_Start}` and `\p{ID_Continue}` mean the classes JavaScript uses.
 */
const EACH =
  /^\s*([\p{ID_Start}$_][\p{ID_Continue}$\u200C\u200D]*)\s*(?:,\s*([\p{ID_Start}$_][\p{ID_Continue}$\u200C\u200D]*)\s*)?\s+of\s+([\s\S]+?)\s*$/u;

/**
 * Words a module cannot declare with `const`.
 *
 * codegen.js renames every loop name, so the server would render `class of
 * items`. The type-check shim does not rename: it writes `for (const class of
 * …)`, and tsc reports a syntax error on a line the author never wrote.
 */
const RESERVED = new Set([
  'arguments', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
  'debugger', 'default', 'delete', 'do', 'else', 'enum', 'eval', 'export',
  'extends', 'false', 'finally', 'for', 'function', 'if', 'implements',
  'import', 'in', 'instanceof', 'interface', 'let', 'new', 'null', 'package',
  'private', 'protected', 'public', 'return', 'static', 'super', 'switch',
  'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with',
  'yield',
]);

/**
 * The three parts of an `each`, or null when it does not parse.
 *
 * `item, item of items` is refused: the index would shadow the item, and the
 * page would show `0`, `1` where it wrote `${item}`.
 *
 * @param {string} value the attribute as written
 * @returns {{ item: string, index: string|null, list: string }|null}
 */
export function parseEach(value) {
  const found = EACH.exec(value ?? '');
  if (!found) return null;

  const [, item, index, list] = found;
  if (RESERVED.has(item) || RESERVED.has(index)) return null;
  if (index === item) return null;

  return { item, index: index ?? null, list };
}
