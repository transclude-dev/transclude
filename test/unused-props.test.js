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

