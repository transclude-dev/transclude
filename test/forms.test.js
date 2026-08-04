// A custom element that a <form> submits.
//
// The compiler half is here. The part that needs a real form is in
// app/routes/check.html: whether the browser counts it as a control, and whether
// reset works. Nothing in Node has an ElementInternals to hand out.

import test from 'node:test';
import assert from 'node:assert/strict';

import { compileComponent, readFlags, ELEMENT_FLAGS } from '../src/compiler/index.js';
import { toFunctionBody } from '../src/compiler/script.js';

const block = (code) => [{ code, offset: 0, line: 1 }];
const bodyOf = (code) =>
  toFunctionBody(block(code), 'a-a.html <script>', { lift: 'prototype', flags: ELEMENT_FLAGS });

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
  assert.equal(bodyOf('export const formAssociated = true;').flags.formAssociated, true);
});

test('the export is lifted out of the setup code, not run per element', () => {
  // It becomes a static class field. Leaving it in `init` would be a statement
  // that runs once per element and means nothing.
  const out = bodyOf('export const formAssociated = true;\nhost.id;');
  assert.doesNotMatch(out.body, /export/);
  assert.match(out.body, /host\.id;/);
});

test('opting out explicitly compiles the same as not opting in', () => {
  const off = componentOf('<script>\nexport const formAssociated = false;\n</script>\n<p>x</p>');
  const silent = componentOf('<p>x</p>');

  assert.match(off, /export const formAssociated = false;/);
  assert.match(silent, /export const formAssociated = false;/);
});

test('a block still reports which of those two it was', () => {
  // The compiled module cannot tell them apart and does not need to. The block
  // can, which is what makes "declared in both blocks" something to report.
  assert.equal(bodyOf('export const formAssociated = false;').flags.formAssociated, false);
  assert.equal(bodyOf('host.id;').flags.formAssociated, null, 'silence is not a `false`');
});

test('it coexists with an exported prototype', () => {
  const out = bodyOf('export const prototype = { a() {} };\nexport const formAssociated = true;');
  assert.equal(out.flags.formAssociated, true);
  assert.ok(out.lifted, 'the prototype still got lifted');
});

// ---- either block ----------------------------------------------------------

test('the properties block can declare it, so a form control needs no <script>', () => {
  const source =
    '<script properties>\nexport default { name: \'\' };\nexport const formAssociated = true;\n</script>\n<button>x</button>';

  const code = componentOf(source, { shadow: false });
  assert.match(code, /export const formAssociated = true;/);
  assert.doesNotMatch(source, /<script>/, 'the point is that none is needed');
});

test('the flag is taken out of the properties block, not left in it', () => {
  // It would otherwise be a second `export const formAssociated` in the module.
  const code = componentOf(
    '<script properties>\nexport default { name: \'\' };\nexport const formAssociated = true;\n</script>\n<p>x</p>',
  );
  assert.equal(code.match(/export const formAssociated/g).length, 1);
});

test('a prop declared after the flag still lands, so offsets survive the cut', () => {
  const code = componentOf(
    '<script properties>\nexport const formAssociated = true;\nexport default { name: \'\', tone: \'warn\' };\n</script>\n<p>x</p>',
  );
  assert.match(code, /export const formAssociated = true;/);
  assert.match(code, /tone: 'warn'/, 'the default export was read from the blanked source');
});

test('declaring it in both blocks is refused', () => {
  assert.throws(
    () =>
      componentOf(
        '<script properties>\nexport default {};\nexport const formAssociated = true;\n</script>\n<p>x</p>\n<script>\nexport const formAssociated = false;\n</script>',
      ),
    /declares `formAssociated` in both/,
  );
});

test('a computed value is refused in the properties block too', () => {
  assert.throws(
    () =>
      componentOf(
        '<script properties>\nexport default {};\nexport const formAssociated = enabled;\n</script>\n<p>x</p>',
      ),
    /must be `true` or `false`/,
  );
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
    (error) => /`prototype`, `shadow`, `formAssociated`/.test(error.message),
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
  // because being a control is itself behavior.
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

// ---- shadow is a flag too ---------------------------------------------------

test('an element is light unless its file says otherwise', () => {
  const code = componentOf('<p>x</p>', { shadow: false });
  assert.match(code, /export const light = true;/);
});

test('the file decides, whatever the caller passed', () => {
  // The plugin reads the flag and passes it back in. A file that says which it
  // is has to win, or the types and the render could describe different things.
  const declared =
    '<script properties>\nexport default {};\nexport const shadow = true;\n</script>\n<p>x</p>';

  assert.match(componentOf(declared, { shadow: false }), /export const light = false;/);
});

test('shadow can be declared in the client block as well', () => {
  const code = componentOf('<p>x</p>\n<script>\nexport const shadow = true;\n</script>', {
    shadow: false,
  });
  assert.match(code, /export const light = false;/);
});

test('declaring shadow in both blocks is refused', () => {
  assert.throws(
    () =>
      componentOf(
        '<script properties>\nexport default {};\nexport const shadow = true;\n</script>\n<p>x</p>\n<script>\nexport const shadow = false;\n</script>',
      ),
    /declares `shadow` in both/,
  );
});

test('readFlags sees what the compile sees', () => {
  // Two readers of one file. They disagreeing is a page compiled for a tag that
  // renders the other way, which nothing would report.
  const source =
    '<script properties>\nexport default {};\nexport const shadow = true;\nexport const formAssociated = true;\n</script>\n<p>x</p>';

  assert.deepEqual(readFlags(source, 'a-a.html'), { shadow: true, formAssociated: true });
  assert.match(componentOf(source, { shadow: false }), /export const light = false;/);
  assert.match(componentOf(source, { shadow: false }), /export const formAssociated = true;/);
});

test('state compiles in a light element, and registers it', () => {
  // State is behavior: its accessors are the only way to change it, so an
  // element that has some is defined even with no <script> block at all.
  const code = componentOf('<script state>\nexport default { n: 0 };\n</script>\n<p>${n}</p>', {
    shadow: false,
  });

  assert.match(code, /export const light = true;/);
  assert.match(code, /defineLight\(def,/);
});
