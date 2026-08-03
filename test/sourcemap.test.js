// Mapping a generated line back to the line of `.html` it came from.
//
// A wrong map is worse than none: it sends you confidently to the wrong line.
// So these check positions, not that a map was produced.

import test from 'node:test';
import assert from 'node:assert/strict';

import { inlineMap, lineMap, sourceMap } from '../src/compiler/sourcemap.js';

/** What a consumer reads back: generated line (0-based) to source line. */
function decode(json) {
  const { mappings } = JSON.parse(json);
  const out = [];
  let line = 0;

  mappings.split(';').forEach((segment, generated) => {
    if (!segment) {
      out[generated] = null;
      return;
    }
    const fields = unvlq(segment);
    line += fields[2];
    out[generated] = line + 1;
  });
  return out;
}

function unvlq(segment) {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const values = [];
  let shift = 0;
  let value = 0;

  for (const ch of segment) {
    const digit = ALPHABET.indexOf(ch);
    const more = digit & 32;
    value += (digit & 31) << shift;
    if (more) {
      shift += 5;
      continue;
    }
    const negative = value & 1;
    value >>= 1;
    values.push(negative ? -value : value);
    value = 0;
    shift = 0;
  }
  return values;
}

test('a generated line reports the source line it came from', () => {
  const map = sourceMap([12, 13, null, 40], 'notes.html', '<p></p>');
  assert.deepEqual(decode(map), [12, 13, null, 40]);
});

test('a line the compiler wrote itself maps to nothing', () => {
  // Better than the nearest guess. A stack in generated scaffolding should say
  // so rather than point at a line of markup that had no part in it.
  const decoded = decode(sourceMap([null, null, 7], 'p.html', ''));
  assert.deepEqual(decoded, [null, null, 7]);
});

test('source lines that go backwards still decode', () => {
  // The field is a delta, so a block emitted after one further down the file is
  // a negative number. Getting the sign wrong is silent and this is the case
  // that catches it.
  assert.deepEqual(decode(sourceMap([50, 10, 60], 'p.html', '')), [50, 10, 60]);
});

test('the file travels with the map, so nothing has to find it', () => {
  const map = JSON.parse(sourceMap([1], 'app/routes/notes.html', '<p>${x}</p>'));

  assert.deepEqual(map.sources, ['app/routes/notes.html']);
  assert.deepEqual(map.sourcesContent, ['<p>${x}</p>']);
  assert.equal(map.version, 3);
});

test('the comment is one a runtime reads, and round-trips', () => {
  const json = sourceMap([3], 'p.html', 'x');
  const comment = inlineMap(json);

  const encoded = comment.match(/base64,([A-Za-z0-9+/=]+)/)[1];
  assert.equal(Buffer.from(encoded, 'base64').toString('utf8'), json);
});

// ---- placing a block in the assembled module -------------------------------

test('a marker says where a block landed, and leaves no trace', () => {
  const code = ['const a = 1;', '/*@1*/', 'line one', 'line two', 'const b = 2;'].join('\n');
  const { code: clean, lines } = lineMap(code, [{ marker: '/*@1*/', at: [10, 11] }]);

  assert.doesNotMatch(clean, /@1/, 'the marker shipped');
  assert.deepEqual(clean.split('\n'), ['const a = 1;', 'line one', 'line two', 'const b = 2;']);
  assert.deepEqual(lines, [null, 10, 11, null]);
});

test('two blocks each land where they were written', () => {
  const code = ['head', '/*@a*/', 'A1', '/*@b*/', 'B1', 'B2', 'tail'].join('\n');
  const { code: clean, lines } = lineMap(code, [
    { marker: '/*@a*/', at: [5] },
    { marker: '/*@b*/', at: [20, 21] },
  ]);

  assert.deepEqual(clean.split('\n'), ['head', 'A1', 'B1', 'B2', 'tail']);
  assert.deepEqual(lines, [null, 5, 20, 21, null]);
});

test('a marker nobody wrote is skipped rather than throwing', () => {
  const { code, lines } = lineMap('a\nb', [{ marker: '/*@gone*/', at: [1] }]);

  assert.equal(code, 'a\nb');
  assert.deepEqual(lines, [null, null]);
});

test('the order blocks are listed in does not move them', () => {
  // The bug this exists for. Removing a marker shifts every line below it, so
  // resolving them in the caller's order recorded a position and then moved it.
  // Listed here bottom-up, which is what the page assembler happens to do.
  const code = ['head', '/*@a*/', 'A1', 'mid', '/*@b*/', 'B1', 'tail'].join('\n');

  const { code: clean, lines } = lineMap(code, [
    { marker: '/*@b*/', at: [20] },
    { marker: '/*@a*/', at: [5] },
  ]);

  assert.deepEqual(clean.split('\n'), ['head', 'A1', 'mid', 'B1', 'tail']);
  assert.deepEqual(lines, [null, 5, null, 20, null]);
});

// ---- a real throw, through a real compile ----------------------------------
//
// The gate. Everything above tests a piece; this renders a page that throws and
// asks where the map says it came from. A map that is merely present is not the
// property worth having: a wrong one sends you to the wrong line with the same
// confidence a right one does.

import { compilePage } from '../src/compiler/index.js';

// `.href`, not `pathToFileURL(url.pathname)`. The second double-encodes a space,
// and this project lives under a path with one in it.
const RUNTIME = new URL('../src/runtime/index.js', import.meta.url).href;

/** The source line a decoded map gives for a 1-based generated line. */
function sourceLineOf(json, generated) {
  const decoded = decode(json);
  return decoded[generated - 1] ?? null;
}

test('a page that throws maps the stack back to the line of markup', async () => {
  // The interpolation is on line 5, and nothing else in the file can throw.
  const source = [
    '<h1>Title</h1>',
    '<p>one</p>',
    '<p>two</p>',
    '<p>three</p>',
    '<p>${post.title}</p>',
    '<p>after</p>',
  ].join('\n');

  const { code, map: json } = compilePage(source, { runtime: RUNTIME, filename: 'notes.html' });

  const mod = await import(`data:text/javascript,${encodeURIComponent(code)}`);
  let generated = null;
  try {
    mod.render({});
    assert.fail('the page did not throw');
  } catch (error) {
    generated = Number(error.stack.split('\n')[1].match(/:(\d+):\d+\)?$/)[1]);
  }

  assert.equal(sourceLineOf(json, generated), 5);
});

test('an interpolation further down a block of prose keeps its own line', async () => {
  // One text node, several lines. Mapping the whole node to where it opened
  // would put every `${}` in a paragraph on the paragraph's first line.
  const source = ['<p>', 'first', 'second', '${boom.x}', '</p>'].join('\n');

  const { code, map: json } = compilePage(source, { runtime: RUNTIME, filename: 'p.html' });

  const mod = await import(`data:text/javascript,${encodeURIComponent(code)}`);
  try {
    mod.render({});
    assert.fail('the page did not throw');
  } catch (error) {
    const generated = Number(error.stack.split('\n')[1].match(/:(\d+):\d+\)?$/)[1]);
    assert.equal(sourceLineOf(json, generated), 4);
  }
});

test('a page with no markup at all carries no map', () => {
  // An empty map is a file a tool fetches and reads to learn nothing. Static
  // markup is not that case: `__o += "<p>…"` really does come from a line, and
  // saying so costs nothing and keeps the map dense.
  assert.equal(compilePage('', { runtime: RUNTIME, filename: 'p.html' }).map, null);
  assert.ok(compilePage('<p>x</p>', { runtime: RUNTIME, filename: 'p.html' }).map);
});

test('no marker survives into the module', () => {
  const { code } = compilePage('<p>${x}</p>', { runtime: RUNTIME, filename: 'p.html' });
  assert.doesNotMatch(code, /@transclude:/);
});
