import test from 'node:test';
import assert from 'node:assert/strict';

import { compileComponent } from '../src/compiler/index.js';

// ---- declared but never used ----------------------------------------------

const compile = (source) =>
  compileComponent(source, { tag: 'x-y', runtime: '/rt.js', filename: 'x-y' }).warnings;

test('a prop nobody reads is reported', () => {
  const warnings = compile(`
    <script element>
      export const properties = { name: 'x', nmae: 'y' };
    </script>
    <h3>\${name}</h3>
  `);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /prop `nmae` is declared but never used/);
});

test('a prop used only in <style> is not reported', () => {
  // `compact` drives :host([compact]) and never appears in the template.
  const warnings = compile(`
    <script element>
      export const properties = { compact: false };
    </script>
    <style>:host([compact]) { padding: 0 }</style>
    <p>hi</p>
  `);
  assert.deepEqual(warnings, []);
});

test('a prop used only in the client <script> is not reported', () => {
  const warnings = compile(`
    <script element>export const properties = { compact: false };
export const prototype = { connected() { this.toggleAttribute('compact'); } };</script>
    <p>hi</p>
  `);
  assert.deepEqual(warnings, []);
});

test('a prop read through a loop counts as used', () => {
  const warnings = compile(`
    <script element>
      export const properties = { tags: ['a'] };
    </script>
    <li each="t of tags">\${t}</li>
  `);
  assert.deepEqual(warnings, []);
});

test('an inexact props object disables the check', () => {
  const warnings = compile(`
    <script element>
      export const properties = { ...base, unused: 1 };
    </script>
    <p>hi</p>
  `);
  assert.deepEqual(warnings, []);
});


// ---- prose is not a use ----------------------------------------------------
//
// The match is a word match against <style> and <script>, which is what keeps
// it quiet enough to leave on. It reads code and not comments: a name left in a
// sentence is the most common thing a half-done rename leaves behind, and
// counting that as a use took the check away from the case it exists for.

test('a prop named only in a JavaScript comment is reported', () => {
  const warnings = compile(`
    <script element>
      // \`tone\` drove the border once. The page sets it now.
      export const properties = { tone: 'neutral' };
    </script>
    <p>hi</p>
  `);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /prop `tone` is declared but never used/);
});

test('a prop named only in a block comment is reported', () => {
  const warnings = compile(`
    <script element>
      /* tone picks the border color */
      export const properties = { tone: 'neutral' };
    </script>
    <p>hi</p>
  `);
  assert.equal(warnings.length, 1);
});

test('a prop named only in a CSS comment is reported', () => {
  const warnings = compile(`
    <script element>
      export const properties = { tone: 'neutral' };
    </script>
    <style>/* tone picks the border color */
    :scope { display: block }</style>
    <p>hi</p>
  `);
  assert.equal(warnings.length, 1);
});

test('a URL in CSS is not a comment', () => {
  // `//` after a colon is a scheme. Reading it as a comment would take the rest
  // of the line with it, and a prop used on the line below would go quiet.
  const warnings = compile(`
    <script element>
      export const properties = { tone: 'neutral' };
    </script>
    <style>
      :scope { background: url(https://x/y.png) }
      :scope[tone='warn'] { border-color: red }
    </style>
    <p>hi</p>
  `);
  assert.deepEqual(warnings, []);
});

test('a real use on the same line as a comment still counts', () => {
  const warnings = compile(`
    <script element>
      export const properties = { compact: false };
    </script>
    <style>:scope[compact] { padding: 0 } /* tight */</style>
    <p>hi</p>
  `);
  assert.deepEqual(warnings, []);
});
