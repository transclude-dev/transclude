// A frame in a bundled stack, mapped to the author's file, exactly.
//
// The property under test is honesty. Node's own consumer takes the nearest
// earlier mapping when a position has none, and in a bundle the nearest
// mapping can belong to a different file: a throw in colophon.html was once
// reported as app/lib/code.js:81, with full confidence. Exact or nothing.

import test from 'node:test';
import assert from 'node:assert/strict';

import { mappedFrames } from '../src/stack.js';
import { sourceMap } from '../src/compiler/sourcemap.js';

const BUNDLE = 'server/entry.js';

/** A stack the way V8 writes one, from bundle positions. */
const stackAt = (...positions) =>
  [
    'TypeError: boom',
    ...positions.map(([line, column]) => `    at load (file:///x/dist/${BUNDLE}:${line}:${column})`),
  ].join('\n');

test('a mapped generated line names its source line', () => {
  // Lines 1 and 2 come from notes.html lines 12 and 13; line 3 is scaffolding.
  const map = JSON.parse(sourceMap([12, 13, null], 'notes.html', ''));

  assert.deepEqual(mappedFrames(stackAt([2, 5]), BUNDLE, map), [
    { source: 'notes.html', line: 13 },
  ]);
});

test('a line the map says nothing about names no file at all', () => {
  // The nearest mapping is one line up and belongs to another statement.
  // Naming it would be the confident wrong answer this module exists to avoid.
  const map = JSON.parse(sourceMap([12, null, null], 'notes.html', ''));

  assert.deepEqual(mappedFrames(stackAt([2, 5]), BUNDLE, map), []);
  assert.deepEqual(mappedFrames(stackAt([3, 5]), BUNDLE, map), []);
});

test("a column before the line's first mapping is scaffolding too", () => {
  // The map's column is 0-based and a stack's is 1-based. A mapping at map
  // column 5 covers stack column 6 and after, and not stack column 5.
  const mappings = ['KAYA'].join(';'); // one segment: column 5, source 0, line 12
  const map = { sources: ['notes.html'], mappings };

  assert.deepEqual(mappedFrames(stackAt([1, 5]), BUNDLE, map), []);
  assert.deepEqual(mappedFrames(stackAt([1, 6]), BUNDLE, map), [
    { source: 'notes.html', line: 13 },
  ]);
});

test('the source index is a running total, so a second file resolves', () => {
  // Line 1 maps into sources[0], line 2 into sources[1]: the second segment
  // carries a source-index delta of 1.
  const map = { sources: ['a.html', 'lib.js'], mappings: 'AAAA;ACAA' };

  assert.deepEqual(mappedFrames(stackAt([2, 1]), BUNDLE, map), [{ source: 'lib.js', line: 1 }]);
});

test("frames come back outermost first, and only the bundle's", () => {
  const map = JSON.parse(sourceMap([12, 13], 'notes.html', ''));
  const stack = [
    'TypeError: boom',
    `    at deep (file:///x/dist/${BUNDLE}:2:1)`,
    '    at other (file:///x/app/lib/code.js:9:9)',
    `    at load (file:///x/dist/${BUNDLE}:1:1)`,
  ].join('\n');

  assert.deepEqual(mappedFrames(stack, BUNDLE, map), [
    { source: 'notes.html', line: 13 },
    { source: 'notes.html', line: 12 },
  ]);
});

test('a stack with no bundle frame maps to nothing', () => {
  const map = JSON.parse(sourceMap([12], 'notes.html', ''));

  assert.deepEqual(mappedFrames('TypeError: boom\n    at x (a.js:1:1)', BUNDLE, map), []);
});

test('a delta that goes backwards decodes, sign and all', () => {
  // Fields are deltas, so a block emitted after one further down the file is a
  // negative number. Dropping the sign bit is silent everywhere but here.
  const map = JSON.parse(sourceMap([50, 10], 'notes.html', ''));

  assert.deepEqual(mappedFrames(stackAt([2, 1]), BUNDLE, map), [
    { source: 'notes.html', line: 10 },
  ]);
});
