// A source map, so a stack from a rendered page names the `.html` file.
//
// Line level, not column. The generated line for an interpolation is one
// statement produced from one expression, so the line is the whole answer and a
// column would claim a precision the codegen does not have.
//
// No dependency. The encoding is small and writing it here keeps the compiler's
// import list what it is.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * One number, base64 VLQ.
 *
 * The low bit is the sign and each group of five bits carries a continuation
 * flag, which is why this is not just base64 of the number.
 *
 * @param {number} value
 * @returns {string}
 */
function vlq(value) {
  let bits = value < 0 ? (-value << 1) | 1 : value << 1;
  let out = '';

  do {
    let digit = bits & 31;
    bits >>>= 5;
    if (bits > 0) digit |= 32;
    out += ALPHABET[digit];
  } while (bits > 0);

  return out;
}

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
export function sourceMap(lines, source, content) {
  const segments = [];
  let previous = 0;

  for (const line of lines) {
    if (line === null || line === undefined) {
      segments.push('');
      continue;
    }
    // Fields: generated column, source index, source line, source column. Every
    // one but the first is relative to the last mapping emitted, which is what
    // makes the format compact and what makes order matter here.
    const target = line - 1;
    segments.push(`${vlq(0)}${vlq(0)}${vlq(target - previous)}${vlq(0)}`);
    previous = target;
  }

  return JSON.stringify({
    version: 3,
    sources: [source],
    sourcesContent: [content],
    names: [],
    mappings: segments.join(';'),
  });
}

/**
 * The map as a comment a runtime will read, for appending to the module.
 *
 * @param {string} json
 * @returns {string}
 */
export function inlineMap(json) {
  const base64 =
    typeof Buffer === 'undefined'
      ? btoa(unescape(encodeURIComponent(json)))
      : Buffer.from(json, 'utf8').toString('base64');

  return `\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${base64}\n`;
}

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
export function lineMap(code, blocks) {
  // In the order they appear, and measured against the text being built rather
  // than the original. Taking them in the order the caller listed them recorded
  // a position and then moved it: removing a marker earlier in the file shifts
  // every line already noted below it, silently, by one per marker.
  const found = blocks
    .map((block) => ({ ...block, index: code.indexOf(block.marker) }))
    .filter((block) => block.index !== -1)
    .sort((a, b) => a.index - b.index);

  const placed = [];
  let text = '';
  let cursor = 0;

  for (const block of found) {
    text += code.slice(cursor, block.index);
    placed.push({ line: countLines(text), at: block.at });
    // The marker and the newline ending its line, so the block moves up into it.
    cursor = block.index + block.marker.length + 1;
  }
  text += code.slice(cursor);

  const total = countLines(text) + 1;
  const lines = new Array(total).fill(null);

  for (const { line, at } of placed) {
    for (let i = 0; i < at.length; i++) {
      if (line + i < total) lines[line + i] = at[i];
    }
  }

  return { code: text, lines };
}

function countLines(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') n += 1;
  return n;
}
