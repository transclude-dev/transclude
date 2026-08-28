// A custom element that a <form> submits.
//
// The compiler half is here. The part that needs a real form is in
// app/routes/check.html: whether the browser counts it as a control, and whether
// reset works. Nothing in Node has an ElementInternals to hand out.

import test from 'node:test';
import assert from 'node:assert/strict';

import { compileComponent, readFlags } from '../src/compiler/index.js';
import { bindElementModule } from '../src/compiler/script.js';

const bodyOf = (code) => bindElementModule({ code, offset: 0, line: 1 }, 'a-a.html <script element>');

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

test('the flag is cut out of the block, not left in it', () => {
  // It becomes a static class field, decided at compile time. Left in place it
  // would be a second `export const formAssociated` in the generated module.
  const out = bodyOf('export const formAssociated = true;\nconst after = 1;');
  assert.doesNotMatch(out.code, /export/);
  assert.match(out.code, /const after = 1;/, 'the line after it did not move');
});

test('opting out explicitly compiles the same as not opting in', () => {
  const off = componentOf('<script element>\nexport const formAssociated = false;\n</script>\n<p>x</p>');
  const silent = componentOf('<p>x</p>');

  assert.match(off, /export const formAssociated = false;/);
  assert.match(silent, /export const formAssociated = false;/);
});

test('a block still reports which of those two it was', () => {
  // The compiled module cannot tell them apart and does not need to. The block
  // can, which is what makes "declared in both blocks" something to report.
  assert.equal(bodyOf('export const formAssociated = false;').flags.formAssociated, false);
  assert.equal(bodyOf('const a = 1;').flags.formAssociated, null, 'silence is not a `false`');
});

test('it coexists with an exported prototype', () => {
  const out = bodyOf('export const prototype = { a() {} };\nexport const formAssociated = true;');
  assert.equal(out.flags.formAssociated, true);
  assert.ok(out.nodes.prototype, 'the prototype still came back');
});

// ---- one block -------------------------------------------------------------

test('a form control needs no members, only the flag', () => {
  const source =
    '<script element>\nexport const properties = { name: \'\' };\nexport const formAssociated = true;\n</script>\n<button>x</button>';

  const code = componentOf(source, { shadow: false });
  assert.match(code, /export const formAssociated = true;/);
  assert.doesNotMatch(source, /prototype/, 'the point is that no behavior is needed');
});

test('the flag is taken out of the block, not left in it', () => {
  // It would otherwise be a second `export const formAssociated` in the module.
  const code = componentOf(
    '<script element>\nexport const properties = { name: \'\' };\nexport const formAssociated = true;\n</script>\n<p>x</p>',
  );
  assert.equal(code.match(/export const formAssociated/g).length, 1);
});

test('a prop declared after the flag still lands, so offsets survive the cut', () => {
  const code = componentOf(
    '<script element>\nexport const formAssociated = true;\nexport const properties = { name: \'\', tone: \'warn\' };\n</script>\n<p>x</p>',
  );
  assert.match(code, /export const formAssociated = true;/);
  assert.match(code, /tone: 'warn'/, 'the default export was read from the blanked source');
});

test('declaring it twice is refused rather than resolved', () => {
  // There is one block and one slot per fact, so this is a duplicate binding
  // rather than two homes disagreeing.
  assert.throws(
    () =>
      componentOf(
        '<script element>\nexport const formAssociated = true;\nexport const formAssociated = false;\n</script>\n<p>x</p>',
      ),
    /already been declared|exported twice/,
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
    (error) => /`properties`, `state`, `prototype`, `attributes`, `shadow`, `formAssociated`/.test(error.message),
  );
});

// ---- what the module says ---------------------------------------------------

test('the module exports it and puts it on the def', () => {
  const code = componentOf('<script element>export const formAssociated = true;</script><p>x</p>');
  assert.match(code, /export const formAssociated = true;/);
  assert.match(code, /volatile, formAssociated,/, 'the runtime reads it off the def');
});

test('a component that never mentions it says so rather than leaving it undefined', () => {
  // `def.formAssociated === true` is the runtime check, so a missing value would
  // work, but writing false is what puts the static field in the output too.
  assert.match(componentOf('<p>x</p>'), /export const formAssociated = false;/);
});

test('a member reaches internals through the element, not through a parameter', () => {
  // `this.internals` is the handle the platform hands out, and it is on the
  // element already. Nothing is injected into scope for it.
  assert.match(
    componentOf(
      '<script element>export const prototype = { updated() { this.internals.setValidity({}); } };</script><p>x</p>',
    ),
    /this\.internals\.setValidity/,
  );
});

test('a light element can be a control too, no shadow root required', () => {
  const code = componentOf('<script element>export const formAssociated = true;</script><p>x</p>', {
    shadow: false,
  });
  assert.match(code, /export const formAssociated = true;/);
  // `defineLight` registers it even with no members: being a control is itself
  // behavior, and an element that submits a value has to exist to do it.
  assert.match(code, /defineLight\(def\)/);
});

// ---- reaching the element ---------------------------------------------------

test('a member reaches internals through `this`, because there is nothing else', () => {
  // Members live on the prototype and are shared by every element; `internals`
  // exists once per element. The block is a module, so the bare name is a free
  // identifier the checker reports, and `this.internals` is the only spelling.
  const out = bodyOf('export const prototype = { check() { return this.internals; } };');
  assert.ok(out.nodes.prototype, 'the prototype came back');
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
    '<script element>\nexport const properties = {};\nexport const shadow = true;\n</script>\n<p>x</p>';

  assert.match(componentOf(declared, { shadow: false }), /export const light = false;/);
});

test('the block may sit after the markup, since it is the same block', () => {
  const code = componentOf('<p>x</p>\n<script element>\nexport const shadow = true;\n</script>', {
    shadow: false,
  });
  assert.match(code, /export const light = false;/);
});

test('declaring shadow twice is refused rather than resolved', () => {
  assert.throws(
    () =>
      componentOf(
        '<script element>\nexport const shadow = true;\nexport const shadow = false;\n</script>\n<p>x</p>',
      ),
    /already been declared|exported twice/,
  );
});

test('readFlags sees what the compile sees', () => {
  // Two readers of one file. They disagreeing is a page compiled for a tag that
  // renders the other way, which nothing would report.
  const source =
    '<script element>\nexport const properties = {};\nexport const shadow = true;\nexport const formAssociated = true;\n</script>\n<p>x</p>';

  assert.deepEqual(readFlags(source, 'a-a.html'), { shadow: true, formAssociated: true });
  assert.match(componentOf(source, { shadow: false }), /export const light = false;/);
  assert.match(componentOf(source, { shadow: false }), /export const formAssociated = true;/);
});

test('state compiles in a light element, and registers it', () => {
  // State is behavior: its accessors are the only way to change it, so an
  // element that has some is defined even with no <script> block at all.
  const code = componentOf('<script element>\nexport const state = { n: 0 };\n</script>\n<p>${n}</p>', {
    shadow: false,
  });

  assert.match(code, /export const light = true;/);
  assert.match(code, /defineLight\(def\);/);
});
