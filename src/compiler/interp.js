// Splits raw text / attribute values into static + `${expr}` parts.
// Brace matching is quote-aware so `${a ? "}" : "x"}` does not terminate early.

/**
 * @typedef {{ type: 'text', value: string } | { type: 'expr', value: string }} Part
 */

/**
 * Text and `${expr}` in source order.
 *
 * There is no escape for a literal `${`, so anything documenting the syntax has
 * to pass its examples in as data rather than write them in a template.
 *
 * @param {string} str raw text or an attribute value
 * @returns {Part[]} empty only for an empty string
 * @throws if a `${` is never closed
 */
export function splitInterpolations(str) {
  const parts = [];
  let text = '';
  let i = 0;

  while (i < str.length) {
    // \${ escapes an interpolation
    if (str[i] === '\\' && str[i + 1] === '$' && str[i + 2] === '{') {
      text += '${';
      i += 3;
      continue;
    }
    if (str[i] === '$' && str[i + 1] === '{') {
      if (text) {
        parts.push({ type: 'text', value: text });
        text = '';
      }
      const { expr, end } = readExpr(str, i + 2);
      parts.push({ type: 'expr', value: expr });
      i = end;
      continue;
    }
    text += str[i];
    i++;
  }

  if (text) parts.push({ type: 'text', value: text });
  return parts;
}

/**
 * Whether a string holds an interpolation, without parsing one.
 *
 * A `\${` is a literal and does not count, which is what the leading character
 * in the pattern is checking.
 *
 * @param {string} str
 * @returns {boolean}
 */
export function hasInterpolation(str) {
  return /(^|[^\\])\$\{/.test(str);
}

function readExpr(str, start) {
  let depth = 1;
  let quote = null;
  let i = start;

  while (i < str.length) {
    const c = str[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === '`') {
      quote = c;
    } else if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) return { expr: str.slice(start, i), end: i + 1 };
    }
    i++;
  }
  throw new Error('unterminated ${ ... } interpolation');
}
