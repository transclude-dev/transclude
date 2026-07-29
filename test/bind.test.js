// Surgical updates.
//
// One invariant carries almost all of these: after bind() + update(), the DOM
// must serialize to exactly what a full render of the same props would have
// produced. That catches a wrong childNodes index, a mis-split text node, an
// escaping difference and a missed attribute in a single assertion, and it is
// the only thing that actually has to be true.

import test from 'node:test';
import assert from 'node:assert/strict';
import { compileComponent } from '../src/compiler/index.js';
import { parseDom, serialize, installDocument } from './dom.js';

installDocument();

const RUNTIME = new URL('../src/runtime/index.js', import.meta.url).href;

async function load(source, opts = {}) {
  const { code } = compileComponent(source, {
    tag: 'x-t',
    shadow: true,
    runtime: RUNTIME,
    ...opts,
  });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

/** Exactly what defineComponent puts in the shadow root. */
const markup = (mod, props) =>
  (mod.css ? `<style>${mod.css}</style>` : '') + mod.render(mod.coerce(props));

async function transition(source, before, after, opts) {
  const mod = await load(source, opts);
  const root = parseDom(markup(mod, before));
  const bindings = mod.bind(root, mod.coerce(before));
  const ok = mod.update(bindings, mod.coerce(after));

  // Both sides go through the same serializer. The comparison is of the tree
  // the browser would hold, not of bytes: escape() writes &quot; inside text
  // where the parser is happy with a bare quote, and the two are the same
  // document.
  return {
    mod,
    ok,
    actual: serialize(root),
    expected: serialize(parseDom(markup(mod, after))),
  };
}

const props = (defaults) => `<script properties>export default ${JSON.stringify(defaults)};</script>`;

// ---- the invariant --------------------------------------------------------

const CASES = [
  {
    name: 'a ${} that is the whole of its element',
    source: `${props({ name: '' })}<h3>\${name}</h3>`,
    before: { name: 'Ada' },
    after: { name: 'Grace' },
  },
  {
    name: 'a ${} between static text, split out of the node the parser built',
    source: `${props({ name: '' })}<p>Hello \${name}, welcome!</p>`,
    before: { name: 'Ada' },
    after: { name: 'Grace Hopper' },
  },
  {
    name: 'a ${} with static text only before it',
    source: `${props({ name: '' })}<p>Hello \${name}</p>`,
    before: { name: 'Ada' },
    after: { name: '' },
  },
  {
    name: 'a ${} with static text only after it',
    source: `${props({ name: '' })}<p>\${name} — analyst</p>`,
    before: { name: 'Ada' },
    after: { name: 'Grace' },
  },
  {
    name: 'a value that rendered to nothing and now does not',
    source: `${props({ name: '' })}<h3>\${name}</h3><b>after</b>`,
    before: { name: '' },
    after: { name: 'Ada' },
  },
  {
    name: 'a value that has to be escaped',
    source: `${props({ name: '' })}<h3>\${name}</h3>`,
    before: { name: 'Ada' },
    after: { name: '<script>alert(1)</script> & "quotes"' },
  },
  {
    name: 'a whole attribute value',
    source: `${props({ role: '' })}<p title="\${role}">x</p>`,
    before: { role: 'Analyst' },
    after: { role: 'Rear Admiral' },
  },
  {
    name: 'an attribute mixing static text and a ${}',
    source: `${props({ role: '' })}<p class="role \${role}">x</p>`,
    before: { role: 'analyst' },
    after: { role: 'admiral' },
  },
  {
    name: 'an attribute that drops when the value goes false',
    source: `${props({ compact: false })}<p hidden="\${compact}">x</p>`,
    before: { compact: true },
    after: { compact: false },
  },
  {
    name: 'an attribute that appears when the value goes true',
    source: `${props({ compact: false })}<p hidden="\${compact}">x</p>`,
    before: { compact: false },
    after: { compact: true },
  },
  {
    name: 'several bindings at different depths',
    source:
      `${props({ name: '', role: '', slug: '' })}` +
      `<article><h3>\${name}</h3><p class="\${slug}">Role: \${role}</p></article>`,
    before: { name: 'Ada', role: 'Analyst', slug: 'a' },
    after: { name: 'Grace', role: 'Admiral', slug: 'g' },
  },
  {
    // The runtime prepends <style> to the shadow root, so the template's own
    // first node is not at index 0. Getting this wrong is invisible in any
    // component that happens to have no styles.
    name: 'a shadow root that starts with the component <style>',
    source: `<style>h3 { color: red }</style>${props({ name: '' })}<h3>\${name}</h3>`,
    before: { name: 'Ada' },
    after: { name: 'Grace' },
  },
  {
    name: 'a <style> with whitespace between it and the first node',
    source: `<style>h3 { color: red }</style>\n${props({ name: '' })}\n<h3>\${name}</h3>`,
    before: { name: 'Ada' },
    after: { name: 'Grace' },
  },
  {
    name: 'an if that turns on',
    source: `${props({ show: false, role: '' })}<p if="show">\${role}</p>`,
    before: { show: false, role: 'Analyst' },
    after: { show: true, role: 'Analyst' },
  },
  {
    name: 'an if that turns off',
    source: `${props({ show: false, role: '' })}<p if="show">\${role}</p>`,
    before: { show: true, role: 'Analyst' },
    after: { show: false, role: 'Analyst' },
  },
  {
    name: 'an if/else-if/else chain changing branch',
    source:
      `${props({ n: 0 })}` +
      `<p if="n > 1">many</p><p else-if="n > 0">one</p><p else>none</p>`,
    before: { n: 0 },
    after: { n: 5 },
  },
  {
    name: 'a binding that comes after a block',
    source: `${props({ show: false, name: '' })}<p if="show">x</p><h3>\${name}</h3>`,
    before: { show: false, name: 'Ada' },
    after: { show: true, name: 'Grace' },
  },
  {
    name: 'two blocks with a binding between and after them',
    source:
      `${props({ a: false, b: false, name: '' })}` +
      `<p if="a">A</p><h3>\${name}</h3><p if="b">B</p><b>\${name}</b>`,
    before: { a: false, b: true, name: 'Ada' },
    after: { a: true, b: false, name: 'Grace' },
  },
  {
    // After a block the walk steps sibling by sibling, and a split text node
    // leaves its static tail behind as a node of its own. Miscounting that
    // silently shifts everything after it.
    name: 'a split text node and an element after a block',
    source:
      `${props({ show: false, name: '', role: '' })}` +
      `<p if="show">x</p>Hello \${name}!<b>\${role}</b>`,
    before: { show: false, name: 'Ada', role: 'Analyst' },
    after: { show: true, name: 'Grace', role: 'Admiral' },
  },
  {
    name: 'a prefix-only text node and an element after a block',
    source:
      `${props({ show: false, name: '', role: '' })}` +
      `<p if="show">x</p>Hello \${name}<b>\${role}</b>`,
    before: { show: true, name: 'Ada', role: 'Analyst' },
    after: { show: false, name: 'Grace', role: 'Admiral' },
  },
  {
    name: 'an each that grows',
    source: `${props({ tags: [] })}<ul><li each="tag of tags">\${tag}</li></ul>`,
    before: { tags: ['a'] },
    after: { tags: ['a', 'b', 'c'] },
  },
  {
    name: 'an each that shrinks to nothing',
    source: `${props({ tags: [] })}<ul><li each="tag of tags">\${tag}</li></ul>`,
    before: { tags: ['a', 'b', 'c'] },
    after: { tags: [] },
  },
  {
    name: 'a keyed each that reorders',
    source: `${props({ tags: [] })}<ul><li each="tag of tags" key="tag">\${tag}</li></ul>`,
    before: { tags: ['a', 'b', 'c'] },
    after: { tags: ['c', 'a', 'b'] },
  },
  {
    name: 'a keyed each with an insert, a removal and a move at once',
    source: `${props({ tags: [] })}<ul><li each="tag of tags" key="tag">\${tag}</li></ul>`,
    before: { tags: ['a', 'b', 'c', 'd'] },
    after: { tags: ['d', 'x', 'b'] },
  },
  {
    name: 'a keyed each whose item content changed under the same key',
    source:
      `${props({ rows: [] })}` +
      `<ul><li each="row of rows" key="row.id">\${row.label}</li></ul>`,
    before: { rows: [{ id: 1, label: 'one' }, { id: 2, label: 'two' }] },
    after: { rows: [{ id: 1, label: 'ONE' }, { id: 2, label: 'two' }] },
  },
  {
    name: 'a keyed each using the loop index',
    source:
      `${props({ tags: [] })}` +
      `<ul><li each="tag, i of tags" key="tag" data-i="\${i}">\${tag}</li></ul>`,
    before: { tags: ['a', 'b'] },
    after: { tags: ['b', 'a'] },
  },
  {
    name: 'content changing inside a branch that stays chosen',
    source:
      `${props({ show: false, label: '' })}` +
      `<div if="show"><span>\${label}</span></div>`,
    before: { show: true, label: 'one' },
    after: { show: true, label: 'two' },
  },
  {
    name: 'an if nested inside another if',
    source:
      `${props({ outer: false, inner: false, label: '' })}` +
      `<div if="outer"><p if="inner">\${label}</p></div>`,
    before: { outer: true, inner: false, label: 'x' },
    after: { outer: true, inner: true, label: 'y' },
  },
  {
    name: 'an each nested inside an if',
    source:
      `${props({ show: false, tags: [] })}` +
      `<div if="show"><ul><li each="tag of tags" key="tag">\${tag}</li></ul></div>`,
    before: { show: true, tags: ['a', 'b'] },
    after: { show: true, tags: ['b', 'c', 'a'] },
  },
  {
    name: 'an item whose content changed under a stable key',
    source:
      `${props({ rows: [] })}` +
      `<ul><li each="row of rows" key="row.id" data-id="\${row.id}">\${row.label}</li></ul>`,
    before: { rows: [{ id: 1, label: 'one' }, { id: 2, label: 'two' }] },
    after: { rows: [{ id: 1, label: 'ONE' }, { id: 2, label: 'TWO' }] },
  },
  {
    name: 'an if inside a loop item',
    source:
      `${props({ rows: [] })}` +
      `<ul><li each="row of rows" key="row.id"><b if="row.urgent">!</b>\${row.label}</li></ul>`,
    before: { rows: [{ id: 1, label: 'a', urgent: false }, { id: 2, label: 'b', urgent: true }] },
    after: { rows: [{ id: 1, label: 'a', urgent: true }, { id: 2, label: 'b', urgent: false }] },
  },
  {
    name: 'an if inside a loop item, using the loop index',
    source:
      `${props({ rows: [] })}` +
      `<ul><li each="row, i of rows" key="row"><b if="i > 0">\${i}</b>\${row}</li></ul>`,
    before: { rows: ['a', 'b', 'c'] },
    after: { rows: ['c', 'a'] },
  },
  {
    name: 'a loop nested inside a loop item',
    source:
      `${props({ groups: [] })}` +
      `<ul><li each="g of groups" key="g.id"><b each="tag of g.tags" key="tag">\${tag}</b></li></ul>`,
    before: { groups: [{ id: 1, tags: ['a', 'b'] }] },
    after: { groups: [{ id: 1, tags: ['b', 'c'] }, { id: 2, tags: ['z'] }] },
  },
  {
    name: 'a template each, which renders many nodes per item',
    source: `${props({ rows: [] })}<template each="row of rows"><b>\${row}</b><i>x</i></template>`,
    before: { rows: ['a'] },
    after: { rows: ['a', 'b'] },
  },
  {
    name: 'a keyed template each, reordered',
    source:
      `${props({ rows: [] })}` +
      `<dl><template each="row of rows" key="row.id"><dt>\${row.id}</dt><dd>\${row.label}</dd></template></dl>`,
    before: { rows: [{ id: 1, label: 'a' }, { id: 2, label: 'b' }, { id: 3, label: 'c' }] },
    after: { rows: [{ id: 3, label: 'c' }, { id: 1, label: 'a' }, { id: 2, label: 'b' }] },
  },
  {
    name: 'a keyed template each with an insert, a removal and a content change',
    source:
      `${props({ rows: [] })}` +
      `<dl><template each="row of rows" key="row.id"><dt>\${row.id}</dt><dd>\${row.label}</dd></template></dl>`,
    before: { rows: [{ id: 1, label: 'a' }, { id: 2, label: 'b' }] },
    after: { rows: [{ id: 2, label: 'B!' }, { id: 9, label: 'new' }] },
  },
  {
    name: 'a template each whose items contain a block',
    source:
      `${props({ rows: [] })}` +
      `<dl><template each="row of rows" key="row.id"><dt if="row.big">BIG</dt><dd>\${row.label}</dd></template></dl>`,
    before: { rows: [{ id: 1, label: 'a', big: false }, { id: 2, label: 'b', big: true }] },
    after: { rows: [{ id: 2, label: 'b', big: false }, { id: 1, label: 'a', big: true }] },
  },
  {
    name: 'a template each shrinking to nothing',
    source: `${props({ rows: [] })}<dl><template each="row of rows" key="row"><dt>\${row}</dt><dd>x</dd></template></dl>`,
    before: { rows: ['a', 'b'] },
    after: { rows: [] },
  },
  {
    name: 'a template each item whose text renders empty',
    source: `${props({ rows: [] })}<dl><template each="row of rows" key="row.id">\${row.label}<dd>x</dd></template></dl>`,
    before: { rows: [{ id: 1, label: 'a' }] },
    after: { rows: [{ id: 1, label: 'a' }, { id: 2, label: '' }] },
  },
  {
    name: 'a block nested inside another block',
    source:
      `${props({ show: false, tags: [] })}` +
      `<div if="show"><ul><li each="tag of tags">\${tag}</li></ul></div>`,
    before: { show: true, tags: ['a'] },
    after: { show: true, tags: ['a', 'b'] },
  },
  {
    name: 'several ${} in one text node',
    source: `${props({ a: '', b: '' })}<p>\${a} and \${b}!</p>`,
    before: { a: 'x', b: 'y' },
    after: { a: 'one', b: 'two' },
  },
  {
    name: 'a binding after a comment the renderer strips',
    source: `${props({ name: '' })}<b>x</b><!-- note --><h3>\${name}</h3>`,
    before: { name: 'Ada' },
    after: { name: 'Grace' },
  },
  {
    name: 'a binding inside a nested element with whitespace around it',
    source: `${props({ name: '' })}<div>\n  <h3>\${name}</h3>\n</div>`,
    before: { name: 'Ada' },
    after: { name: 'Grace' },
  },
];

for (const testCase of CASES) {
  test(`updating in place matches a full render — ${testCase.name}`, async () => {
    const { ok, actual, expected } = await transition(
      testCase.source,
      testCase.before,
      testCase.after,
    );
    assert.equal(ok, true, 'fell back to a repaint');
    assert.equal(actual, expected);
  });
}

// ---- what it refuses to bind ----------------------------------------------

test('structure no longer forces a repaint — it is a block of its own', async () => {
  const mod = await load(
    `${props({ show: false, name: '', role: '', tags: [] })}` +
      `<h3>\${name}</h3><p if="show">\${role}</p><li each="tag of tags">\${tag}</li>`,
  );
  assert.deepEqual(mod.volatile, []);
});

test('only the block that changed is touched, not its neighbours', async () => {
  const mod = await load(
    `${props({ a: false, b: false })}<p if="a">A</p><p if="b">B</p>`,
  );
  const root = parseDom(markup(mod, { a: true, b: true }));
  const bindings = mod.bind(root, mod.coerce({ a: true, b: true }));
  const untouched = root.childNodes[4];

  mod.update(bindings, mod.coerce({ a: false, b: true }));

  assert.equal(untouched.parentNode, root, 'the second block was rebuilt too');
  assert.equal(serialize(root), serialize(parseDom(markup(mod, { a: false, b: true }))));
});

test('a branch that stays chosen is written into, not rebuilt', async () => {
  const mod = await load(
    `${props({ show: false, label: '' })}<div if="show"><span>\${label}</span></div>`,
  );
  const before = { show: true, label: 'one' };
  const root = parseDom(markup(mod, before));
  const bindings = mod.bind(root, mod.coerce(before));
  const div = root.childNodes[1];

  mod.update(bindings, mod.coerce({ show: true, label: 'two' }));
  assert.equal(root.childNodes[1], div, 'the branch was rebuilt for a content change');
  assert.equal(div.textContent, 'two');
});

test('changing branch does rebuild — that is a structural change', async () => {
  const mod = await load(
    `${props({ show: false })}<p if="show">yes</p><p else>no</p>`,
  );
  const before = { show: true };
  const root = parseDom(markup(mod, before));
  const bindings = mod.bind(root, mod.coerce(before));
  const paragraph = root.childNodes[1];

  mod.update(bindings, mod.coerce({ show: false }));
  assert.notEqual(root.childNodes[1], paragraph);
  assert.equal(root.childNodes[1].textContent, 'no');
});

test('an item is written into when its content changes under the same key', async () => {
  const source = `${props({ rows: [] })}<ul><li each="row of rows" key="row.id">\${row.label}</li></ul>`;
  const mod = await load(source);
  const before = { rows: [{ id: 1, label: 'one' }, { id: 2, label: 'two' }] };
  const root = parseDom(markup(mod, before));
  const bindings = mod.bind(root, mod.coerce(before));

  const list = root.childNodes[0];
  const [first, second] = list.childNodes.filter((node) => node.tagName === 'li');

  mod.update(bindings, mod.coerce({ rows: [{ id: 1, label: 'CHANGED' }, { id: 2, label: 'two' }] }));

  const after = list.childNodes.filter((node) => node.tagName === 'li');
  assert.equal(after[0], first, 'the row was replaced rather than written into');
  assert.equal(after[1], second);
  assert.equal(first.textContent, 'CHANGED');
});

test('an unkeyed list reconciles by position, so rows are reused too', async () => {
  const mod = await load(`${props({ tags: [] })}<ul><li each="tag of tags">\${tag}</li></ul>`);
  const before = { tags: ['a', 'b'] };
  const root = parseDom(markup(mod, before));
  const bindings = mod.bind(root, mod.coerce(before));

  const list = root.childNodes[0];
  const [first] = list.childNodes.filter((node) => node.tagName === 'li');

  mod.update(bindings, mod.coerce({ tags: ['z', 'b', 'c'] }));

  const after = list.childNodes.filter((node) => node.tagName === 'li');
  assert.equal(after[0], first, 'position 0 should have been written into');
  assert.equal(after.map((node) => node.textContent).join(), 'z,b,c');
});

test('a block inside a block is bound, not swept away with its parent', async () => {
  const mod = await load(
    `${props({ show: false, tags: [] })}` +
      `<div if="show"><ul><li each="tag of tags" key="tag">\${tag}</li></ul></div>`,
  );
  const before = { show: true, tags: ['a', 'b'] };
  const root = parseDom(markup(mod, before));
  const bindings = mod.bind(root, mod.coerce(before));

  const div = root.childNodes[1];
  const rows = () =>
    root.childNodes[1].childNodes
      .flatMap((node) => (node.tagName === 'ul' ? node.childNodes : []))
      .filter((node) => node.tagName === 'li');
  const [first] = rows();

  mod.update(bindings, mod.coerce({ show: true, tags: ['a', 'b', 'c'] }));

  assert.equal(root.childNodes[1], div, 'the outer block was rebuilt');
  assert.equal(rows()[0], first, 'the inner block was rebuilt rather than reconciled');
  assert.equal(rows().map((node) => node.textContent).join(), 'a,b,c');
});

test('a block inside a loop item no longer costs the list its bindings', async () => {
  const source =
    `${props({ rows: [] })}` +
    `<ul><li each="row of rows" key="row.id"><b if="row.urgent">!</b>\${row.label}</li></ul>`;
  const mod = await load(source);

  // Before loop arguments, a block here had no way to be a function of the item,
  // so the item part gave up and the whole list re-rendered on any change.
  assert.match(mod.def.render.toString() + '', /./);
  const before = { rows: [{ id: 1, label: 'a', urgent: false }, { id: 2, label: 'b', urgent: false }] };
  const root = parseDom(markup(mod, before));
  const bindings = mod.bind(root, mod.coerce(before));

  const list = root.childNodes[0];
  const rows = () => list.childNodes.filter((node) => node.tagName === 'li');
  const [first, second] = rows();

  mod.update(
    bindings,
    mod.coerce({ rows: [{ id: 1, label: 'A', urgent: true }, { id: 2, label: 'b', urgent: false }] }),
  );

  assert.equal(rows()[0], first, 'the row was rebuilt rather than written into');
  assert.equal(rows()[1], second);
  assert.equal(serialize(root), serialize(parseDom(markup(mod, {
    rows: [{ id: 1, label: 'A', urgent: true }, { id: 2, label: 'b', urgent: false }],
  }))));
});

test('a multi-node item is reconciled as a range, not rebuilt', async () => {
  const source =
    `${props({ rows: [] })}` +
    `<dl><template each="row of rows" key="row.id"><dt>\${row.id}</dt><dd>\${row.label}</dd></template></dl>`;
  const mod = await load(source);
  const before = { rows: [{ id: 1, label: 'a' }, { id: 2, label: 'b' }, { id: 3, label: 'c' }] };
  const root = parseDom(markup(mod, before));
  const bindings = mod.bind(root, mod.coerce(before));

  const list = root.childNodes[0];
  const cells = () => list.childNodes.filter((node) => node.tagName === 'dd');
  const [first, second, third] = cells();

  mod.update(
    bindings,
    mod.coerce({ rows: [{ id: 3, label: 'c' }, { id: 1, label: 'A!' }, { id: 2, label: 'b' }] }),
  );

  const after = cells();
  assert.deepEqual(after.map((node) => list.childNodes.indexOf(node) >= 0), [true, true, true]);
  assert.deepEqual([after[0] === third, after[1] === first, after[2] === second], [true, true, true]);
  assert.equal(first.textContent, 'A!', 'the moved row was not written into');
});

test('an item that renders no text still binds into the right parent', async () => {
  // A part reads __n.parentNode. Binding before insertion would make that the
  // scratch element the markup was parsed in, and every later write would go
  // somewhere detached.
  const source = `${props({ rows: [] })}<dl><template each="row of rows" key="row.id">\${row.label}<dd>x</dd></template></dl>`;
  const mod = await load(source);
  const before = { rows: [{ id: 1, label: 'a' }] };
  const root = parseDom(markup(mod, before));
  const bindings = mod.bind(root, mod.coerce(before));

  mod.update(bindings, mod.coerce({ rows: [{ id: 1, label: 'a' }, { id: 2, label: '' }] }));
  mod.update(bindings, mod.coerce({ rows: [{ id: 1, label: 'a' }, { id: 2, label: 'filled in' }] }));

  assert.equal(
    serialize(root),
    serialize(parseDom(markup(mod, { rows: [{ id: 1, label: 'a' }, { id: 2, label: 'filled in' }] }))),
  );
});

test('a keyed reorder reuses the nodes rather than rebuilding them', async () => {
  const source = `${props({ tags: [] })}<ul><li each="tag of tags" key="tag">\${tag}</li></ul>`;
  const mod = await load(source);
  const before = { tags: ['a', 'b', 'c'] };
  const root = parseDom(markup(mod, before));
  const bindings = mod.bind(root, mod.coerce(before));

  const list = root.childNodes[0];
  const original = list.childNodes.filter((node) => node.tagName === 'li');
  original.forEach((node, i) => (node.marked = i));

  mod.update(bindings, mod.coerce({ tags: ['c', 'a', 'b'] }));

  const after = list.childNodes.filter((node) => node.tagName === 'li');
  assert.deepEqual(after.map((node) => node.marked), [2, 0, 1], 'nodes were rebuilt, not moved');
});

test('an unkeyed each rebuilds its region, and only its region', async () => {
  const mod = await load(`${props({ tags: [] })}<b>x</b><li each="tag of tags">\${tag}</li>`);
  const before = { tags: ['a'] };
  const root = parseDom(markup(mod, before));
  const bindings = mod.bind(root, mod.coerce(before));
  const outside = root.childNodes[0];

  mod.update(bindings, mod.coerce({ tags: ['a', 'b'] }));
  assert.equal(root.childNodes[0], outside, 'a node outside the block was replaced');
});

test('a block that did not change is not rewritten at all', async () => {
  const mod = await load(`${props({ show: false, name: '' })}<p if="show">\${name}</p>`);
  const before = { show: true, name: 'Ada' };
  const root = parseDom(markup(mod, before));
  const bindings = mod.bind(root, mod.coerce(before));
  const paragraph = root.childNodes[1];

  mod.update(bindings, mod.coerce(before));
  assert.equal(root.childNodes[1], paragraph, 'an unchanged block was rebuilt');
});

test('html() cannot go in a text node, so update hands back a repaint', async () => {
  const mod = await load(`${props({ body: '' })}<p>\${html(body)}</p>`);
  const root = parseDom(markup(mod, { body: '<em>hi</em>' }));
  const bindings = mod.bind(root, mod.coerce({ body: '<em>hi</em>' }));
  assert.equal(mod.update(bindings, mod.coerce({ body: '<em>bye</em>' })), false);
});

test('a partial gets no bindings at all — it is never repainted', async () => {
  const mod = await load(`${props({ name: '' })}<h3>\${name}</h3>`, { shadow: false });
  assert.equal(mod.bind(), null);
  assert.equal(mod.update(), false);
  assert.deepEqual(mod.volatile, []);
});

// ---- reaching into a child component --------------------------------------

/** The child's module cannot be imported here, so the emitted code is the claim. */
const bindingsOf = (source, opts) => {
  const { code } = compileComponent(source, { tag: 'x-t', shadow: true, runtime: RUNTIME, ...opts });
  return code.slice(code.indexOf('export function bind'), code.indexOf('export const def'));
};

test('a shadow child is updated by writing its attribute, which it reacts to', () => {
  const code = bindingsOf(`${props({ name: '' })}<user-card name="\${name}"></user-card>`, {
    components: new Map([['user-card', '/user-card.js']]),
    shadowTags: new Set(['user-card']),
  });
  assert.match(code, /__setAttrProp\(__C0, __b\[0\], "name", __d\["name"\]\)/);
  assert.match(code, /export const volatile = \[\]/, 'nothing here needs a repaint');
});

test('a light child renders its own markup, so its props force a repaint', () => {
  const code = bindingsOf(`${props({ rows: [] })}<data-table rows="\${rows}"></data-table>`, {
    components: new Map([['data-table', '/data-table.js']]),
    shadowTags: new Set(),
  });
  assert.doesNotMatch(code, /__setAttr\(/);
  assert.match(code, /export const volatile = \["rows"\]/);
});

// ---- per-prop converters ---------------------------------------------------

const converted = `<script properties>
  export default { since: new Date(0), tags: new Set() };
  export const attributes = {
    since: { from: (text) => new Date(text), to: (date) => date.toISOString().slice(0, 10) },
    tags: { from: (text) => new Set(text.split(',')), to: (set) => [...set].join(',') },
  };
</script>`;

test('a converter reads an attribute the default type could not describe', async () => {
  const mod = await load(`${converted}<time>\${since.getFullYear()}</time>`);

  const coerced = mod.coerce({ since: '1843-12-10' });
  assert.ok(coerced.since instanceof Date);
  assert.equal(coerced.since.getUTCFullYear(), 1843);

  const set = mod.coerce({ tags: 'a,b' }).tags;
  assert.ok(set instanceof Set);
  assert.deepEqual([...set], ['a', 'b']);
});

test('an absent attribute is the declared default, untouched by the converter', async () => {
  const mod = await load(`${converted}<p>x</p>`);
  const coerced = mod.coerce({});
  assert.equal(coerced.since.getTime(), 0);
  assert.equal(coerced.tags.size, 0);
});

test('a converter that throws falls back rather than taking the page down', async () => {
  const mod = await load(
    `<script properties>
       export default { n: 0 };
       export const attributes = { n: { from: () => { throw new Error('nope'); } } };
     </script><p>\${n}</p>`,
  );
  assert.equal(mod.coerce({ n: 'anything' }).n, 0);
});

test('a value already of the right type is passed through', async () => {
  // A parent template hands over the real value, not a string.
  const mod = await load(`${converted}<p>x</p>`);
  const when = new Date('1952-01-01');
  assert.equal(mod.coerce({ since: when }).since, when);
});

test("a parent serializes a child's attribute the way that child reads it back", async () => {
  const child = await load(`${converted}<time>\${since.getFullYear()}</time>`, { tag: 'x-child' });
  const { attrProp, setAttrProp } = await import('../src/runtime/index.js');

  // Without the child's `to`, a Date would be JSON — quotes and all — and the
  // child's `from` would get something it cannot parse back.
  assert.equal(attrProp(child.def, 'since', new Date('1843-12-10')), ' since="1843-12-10"');
  assert.equal(child.coerce({ since: '1843-12-10' }).since.getUTCFullYear(), 1843);

  const element = parseDom('<x-child></x-child>').childNodes[0];
  setAttrProp(child.def, element, 'since', new Date('1952-05-06'));
  assert.equal(element.getAttribute('since'), '1952-05-06');
});

test('a parent emits the child converter for both render and update', () => {
  const source =
    `<script properties>export default { when: new Date(0) };</script>` +
    `<x-child since="\${when}"></x-child>`;
  const opts = {
    components: new Map([['x-child', '/x-child.js']]),
    shadowTags: new Set(['x-child']),
  };
  const { code } = compileComponent(source, { tag: 'x-t', shadow: true, runtime: RUNTIME, ...opts });
  assert.match(code, /__ap\(__C0, "since", __d\["when"\]\)/, 'render side');
  assert.match(code, /__setAttrProp\(__C0, __b\[0\], "since", __d\["when"\]\)/, 'update side');
});

test('without a converter the old rules still apply', async () => {
  const mod = await load(
    `<script properties>export default { n: 0, on: false, list: [] };</script><p>x</p>`,
  );
  assert.deepEqual(mod.coerce({ n: '3', on: '', list: '["a"]' }), { n: 3, on: true, list: ['a'] });
});

// ---- moving without moveBefore ---------------------------------------------

/** [a,b,c] -> [b,c,a] moves `b`, so the focused row is the one that moves. */
async function reorderWithFocusOnMovedRow(root) {
  const source = `${props({ rows: [] })}<ul><li each="r of rows" key="r">\${r}</li></ul>`;
  const mod = await load(source);
  const before = { rows: ['a', 'b', 'c'] };
  const dom = parseDom(markup(mod, before));
  const bindings = mod.bind(dom, mod.coerce(before));

  const list = dom.childNodes[0];
  const rows = () => list.childNodes.filter((node) => node.tagName === 'li');
  const moved = rows()[1];
  moved.focus();
  moved.setSelectionRange(2);

  mod.update(bindings, mod.coerce({ rows: ['b', 'c', 'a'] }));
  return { dom, list, rows, moved };
}

test('a fallback move keeps the node, its content and its caret', async () => {
  const { rows, moved } = await reorderWithFocusOnMovedRow();
  assert.equal(rows()[0], moved, 'the moved row was rebuilt');
  assert.equal(moved.textContent, 'b');
  assert.equal(moved.selectionStart, 2, 'the caret moved');
});

test('focus is carried across a move the browser cannot do in place', async () => {
  // The fake DOM has no moveBefore, so this is exactly the fallback path.
  const { moved } = await reorderWithFocusOnMovedRow();
  assert.equal(document.activeElement, moved, 'focus was dropped by the move');
});

test('a row that does not move is never touched, so there is nothing to restore', async () => {
  const source = `${props({ rows: [] })}<ul><li each="r of rows" key="r">\${r}</li></ul>`;
  const mod = await load(source);
  const before = { rows: ['a', 'b', 'c'] };
  const dom = parseDom(markup(mod, before));
  const bindings = mod.bind(dom, mod.coerce(before));

  const list = dom.childNodes[0];
  const stationary = list.childNodes.filter((node) => node.tagName === 'li')[0];
  stationary.focus();

  // Only `c` has to move for this.
  mod.update(bindings, mod.coerce({ rows: ['c', 'a', 'b'] }));
  assert.equal(document.activeElement, stationary);
});
