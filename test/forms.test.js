// A custom element that a <form> submits.
//
// The compiler half is here. The part that needs a real form is in
// app/routes/check.html: whether the browser counts it as a control, and whether
// reset works. Nothing in Node has an ElementInternals to hand out.

import test from 'node:test';
import assert from 'node:assert/strict';

import { compileComponent } from '../src/compiler/index.js';
import { toFunctionBody } from '../src/compiler/script.js';

const block = (code) => [{ code, offset: 0, line: 1 }];
const bodyOf = (code) => toFunctionBody(block(code), 'a-a.html <script>', { lift: 'prototype' });

const componentOf = (source, over = {}) =>
  compileComponent(source, {
    tag: 'a-a',
    shadow: true,
    runtime: '/rt.js',
    filename: 'a-a',
    ...over,
  }).code;

// ---- opting in -------------------------------------------------------------

test('a component opts in with the platform’s own name', () => {
  assert.equal(bodyOf('export const formAssociated = true;').formAssociated, true);
});

test('the export is lifted out of the setup code, not run per element', () => {
  // It becomes a static class field. Leaving it in `init` would be a statement
  // that runs once per element and means nothing.
  const out = bodyOf('export const formAssociated = true;\nhost.id;');
  assert.doesNotMatch(out.body, /export/);
  assert.match(out.body, /host\.id;/);
});

test('opting out explicitly is the same as not opting in', () => {
  assert.equal(bodyOf('export const formAssociated = false;').formAssociated, false);
  assert.equal(bodyOf('host.id;').formAssociated, false);
});

test('it coexists with an exported prototype', () => {
  const out = bodyOf('export const prototype = { a() {} };\nexport const formAssociated = true;');
  assert.equal(out.formAssociated, true);
  assert.ok(out.lifted, 'the prototype still got lifted');
});

test('a computed value is refused, because a static field cannot be one', () => {
  assert.throws(
    () => bodyOf('export const formAssociated = Boolean(1);'),
    /must be `true` or `false`/,
  );
  assert.throws(() => bodyOf('export const formAssociated = flag;'), /must be `true` or `false`/);
});

test('any other export is still refused, and the message says what is allowed', () => {
  assert.throws(
    () => bodyOf('export const nope = true;'),
    (error) => /`prototype` and `formAssociated`/.test(error.message),
  );
});

// ---- what the module says ---------------------------------------------------

test('the module exports it and puts it on the def', () => {
  const code = componentOf('<script>export const formAssociated = true;</script><p>x</p>');
  assert.match(code, /export const formAssociated = true;/);
  assert.match(code, /volatile, formAssociated,/, 'the runtime reads it off the def');
});

test('a component that never mentions it says so rather than leaving it undefined', () => {
  // `def.formAssociated === true` is the runtime check, so a missing value would
  // work, but writing false is what puts the static field in the output too.
  assert.match(componentOf('<p>x</p>'), /export const formAssociated = false;/);
});

test('the block is handed internals alongside host, shadow and signal', () => {
  assert.match(
    componentOf('<script>host.id;</script><p>x</p>'),
    /export async function init\(host, shadow, signal, internals\)/,
  );
});

test('a light element can be a control too, no shadow root required', () => {
  const code = componentOf('<script>export const formAssociated = true;</script><p>x</p>', {
    shadow: false,
  });
  assert.match(code, /export const formAssociated = true;/);
  // `null`, not `init`: lifting the export out leaves no setup code behind, so
  // there is no function to run. `defineLight` decides to register anyway,
  // because being a control is itself behaviour.
  assert.match(code, /defineLight\(def, null\)/);
});

test('setup code alongside the export still becomes init', () => {
  const code = componentOf(
    '<script>export const formAssociated = true;\nhost.id;</script><p>x</p>',
    { shadow: false },
  );
  assert.match(code, /defineLight\(def, init\)/);
});

// ---- what a prototype member may not reach ---------------------------------

test('a prototype member cannot reach internals, for the same reason as host', () => {
  // Members live on the prototype and are shared by every element; `internals`
  // exists once per element. Reaching it from there would be a silently shared
  // handle to somebody else's form state.
  // The message names `internals` rather than the variable that held it, which is
  // the more useful end of the chain to be told about.
  assert.throws(
    () =>
      bodyOf(`const handle = internals;
export const prototype = { check() { return handle; } };`),
    /reaches `internals`/,
  );
});

test('reaching it through `this` is how a member is meant to', () => {
  const out = bodyOf('export const prototype = { check() { return this.internals; } };');
  assert.ok(out.lifted, 'this.internals is per element and needs no lifting');
});
