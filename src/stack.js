// The author's position behind a frame in a bundled stack.
//
// Node can rewrite stacks itself, but its consumer takes the nearest earlier
// mapping when a position has none, and in a bundle the nearest mapping can
// belong to a different file. That answer arrives with full confidence: a
// throw in colophon.html was once reported as app/lib/code.js:81. So the map
// is read exactly here. A frame on a generated line the map says nothing
// about names no file, rather than the neighbor's.
//
// Pure. No `node:` imports: the caller reads the files, this reads the strings.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * The numbers in one VLQ segment, the reverse of what the compiler writes.
 *
 * @param {string} segment
 * @returns {number[]}
 */
function unvlq(segment) {
  const values = [];
  let shift = 0;
  let value = 0;

  for (const ch of segment) {
    const digit = ALPHABET.indexOf(ch);
    value += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
      continue;
    }
    values.push(value & 1 ? -(value >>> 1) : value >>> 1);
    shift = 0;
    value = 0;
  }

  return values;
}

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
export function mappedFrames(stack, bundle, map) {
  /** The bundle position a stack line names, or null. */
  const positionOf = (line) => {
    const at = line.indexOf(bundle);
    if (at === -1) return null;
    const found = line.slice(at + bundle.length).match(/^:(\d+):(\d+)/);
    if (!found) return null;
    return { line: Number(found[1]), column: Number(found[2]) };
  };

  const positions = stack.split('\n').map(positionOf).filter(Boolean);
  if (!positions.length) return [];
  const asked = new Set(positions.map((position) => position.line));

  // One pass over the mappings, keeping only the lines the stack named. The
  // source index and line are running totals across the whole string, so every
  // line is walked whichever ones are kept.
  const lines = map.mappings.split(';');
  const kept = new Map();
  let sourceIndex = 0;
  let sourceLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const decoded = [];
    let column = 0;

    for (const segment of lines[i] ? lines[i].split(',') : []) {
      const fields = unvlq(segment);
      column += fields[0];
      if (fields.length < 4) continue;
      sourceIndex += fields[1];
      sourceLine += fields[2];
      decoded.push({ column, source: map.sources[sourceIndex], line: sourceLine + 1 });
    }

    if (decoded.length && asked.has(i + 1)) kept.set(i + 1, decoded);
  }

  const frames = [];
  for (const position of positions) {
    const decoded = kept.get(position.line);
    if (!decoded) continue;

    // The nearest mapping at or before the column. Within one generated line
    // every mapping is the same module's, so this cannot name a neighbor. A
    // stack column is 1-based and a map column is not.
    let hit = null;
    for (const segment of decoded) {
      if (segment.column <= position.column - 1) hit = segment;
    }
    if (hit) frames.push({ source: hit.source, line: hit.line });
  }

  return frames;
}
