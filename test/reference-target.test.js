// `export const referenceTarget`: the id a shadow root forwards a `<label for>`
// or an `aria-labelledby` to. The compiler checks the id is there, and both
// ways a shadow root is made carry it. Whether a label then reaches the inner
// element is a browser question, checked in app/routes/check.html.

import test from 'node:test';
import assert from 'node:assert/strict';
import { compileComponent } from '../src/compiler/index.js';
import { bindElementModule } from '../src/compiler/script.js';
import { shadow } from '../src/runtime/index.js';

const shadowElement = (markup, target = "'field'") =>
  `<script element>
export const shadow = true;
export const referenceTarget = ${target};
</script>${markup}`;

const compile = (source) =>
  compileComponent(source, { tag: 'x-field', runtime: '/rt.js', filename: 'x-field' });

test('the target is read as a literal and blanked out of the code', () => {
  const { code, referenceTarget } = bindElementModule(
    { code: "export const referenceTarget = 'field';" },
    'x-field.html <script element>',
  );

  assert.equal(referenceTarget, 'field');
  assert.doesNotMatch(code, /export const/);
});

test('a target nobody declared is null', () => {
  const { referenceTarget } = bindElementModule(
    { code: 'export const shadow = true;' },
    'x-field.html <script element>',
  );

  assert.equal(referenceTarget, null);
});

test('a computed target is refused, because it is the same for every element', () => {
  assert.throws(
    () => bindElementModule({ code: "export const referenceTarget = 'fi' + 'eld';" }, 'x'),
    /must be a string: the id of one element/,
  );
  assert.throws(
    () => bindElementModule({ code: 'export const referenceTarget = true;' }, 'x'),
    /must be a string/,
  );
});

test('the compiled definition carries the target', () => {
  const { code } = compile(shadowElement('<input id="field" />'));

  assert.match(code, /export const referenceTarget = "field";/);
  assert.match(code, /formAssociated, referenceTarget,\n\};/);
});

test('an element with no target says null', () => {
  const { code } = compile('<script element>export const shadow = true;</script><p>x</p>');

  assert.match(code, /export const referenceTarget = null;/);
});

test('a target in a light element is refused, and the error says what works instead', () => {
  // A light element has no boundary, so a label already reaches the id.
  const source = "<script element>export const referenceTarget = 'field';</script><input id=\"field\" />";

  assert.throws(() => compile(source), /is a light element/);
  assert.throws(() => compile(source), /point the label at that/);
});

test('a target that names no element in the template is refused', () => {
  assert.throws(() => compile(shadowElement('<input id="other" />')), /no element in its template has `id="field"`/);
});

test('a bound id is not a target, because it is decided per element', () => {
  assert.throws(
    () => compile(shadowElement('<input id="${name}" />')),
    /Write the id out rather than binding it/,
  );
});

test('the target is found inside nested markup', () => {
  const { code } = compile(shadowElement('<div><p><input id="field" /></p></div>'));

  assert.match(code, /export const referenceTarget = "field";/);
});

test('a target inside an each is refused, because every item repeats the id', () => {
  const source = `<script element>
export const shadow = true;
export const referenceTarget = 'field';
export const properties = { items: [] };
</script><ul><li each="item of items"><input id="field" /></li></ul>`;

  assert.throws(() => compile(source), /inside an `each`/);
});

test('the server writes the target on the declarative shadow root', () => {
  const def = { css: '', referenceTarget: 'field', render: () => '<input id="field">', coerce: (p) => p };

  assert.equal(
    shadow(def, {}),
    '<template shadowrootmode="open" shadowrootreferencetarget="field"><input id="field"></template>',
  );
});

test('no target, no attribute', () => {
  const def = { css: '', referenceTarget: null, render: () => '<p>x</p>', coerce: (p) => p };

  assert.equal(shadow(def, {}), '<template shadowrootmode="open"><p>x</p></template>');
});

test('the target is escaped like any other attribute value', () => {
  const def = { css: '', referenceTarget: 'a"b', render: () => '', coerce: (p) => p };

  assert.match(shadow(def, {}), /shadowrootreferencetarget="a&quot;b"/);
});
