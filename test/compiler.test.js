import test from 'node:test';
import assert from 'node:assert/strict';

import { splitBlocks, compileComponent } from '../src/compiler/index.js';
import { compileFragment, CompileError } from '../src/compiler/codegen.js';
import * as rt from '../src/runtime/index.js';

function compile(source, components = new Map()) {
  const blocks = splitBlocks(source);
  return compileFragment(blocks.nodes, { components, page: false });
}

function render(source, data = {}, components = new Map()) {
  const { body } = compile(source, components);
  const fn = new Function(
    '__e', '__a', '__str', '__sh', 'html', '__d',
    `let __o = '';\n${body}\nreturn __o;`,
  );
  return fn(rt.escape, rt.attr, rt.str, rt.shadow, rt.html, data);
}

// ---- escaping -------------------------------------------------------------

test('interpolation escapes by default', () => {
  assert.equal(
    render('<p>${bio}</p>', { bio: '<img src=x onerror=alert(1)>' }),
    '<p>&lt;img src=x onerror=alert(1)&gt;</p>',
  );
});

test('html() is the only opt out', () => {
  assert.equal(render('<p>${html(bio)}</p>', { bio: '<b>hi</b>' }), '<p><b>hi</b></p>');
});

test('static text round-trips entities', () => {
  assert.equal(render('<p>a &amp; b &lt; c</p>'), '<p>a &amp; b &lt; c</p>');
});

// ---- each -----------------------------------------------------------------

test('each iterates', () => {
  assert.equal(
    render('<ul><li each="item of items">${item}</li></ul>', { items: ['a', 'b'] }),
    '<ul><li>a</li><li>b</li></ul>',
  );
});

test('each exposes an index', () => {
  assert.equal(
    render('<li each="item, i of items">${i}:${item}</li>', { items: ['a', 'b'] }),
    '<li>0:a</li><li>1:b</li>',
  );
});

test('each over a missing list renders nothing', () => {
  assert.equal(render('<li each="x of nope">${x}</li>'), '');
});

test('nested each shadowing warns but inner wins', () => {
  const source = '<div each="row of rows"><span each="row of row">${row}</span></div>';
  const { warnings } = compile(source);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /shadows an outer loop variable/);
  assert.equal(
    render(source, { rows: [['a', 'b']] }),
    '<div><span>a</span><span>b</span></div>',
  );
});

test('malformed each is a compile error', () => {
  assert.throws(() => compile('<li each="items">x</li>'), CompileError);
});

// ---- conditionals ---------------------------------------------------------

test('if / else-if / else chain', () => {
  const source = `
    <p if="n > 5">big</p>
    <p else-if="n > 0">small</p>
    <p else>none</p>
  `;
  assert.equal(render(source, { n: 9 }).trim(), '<p>big</p>');
  assert.equal(render(source, { n: 1 }).trim(), '<p>small</p>');
  assert.equal(render(source, { n: 0 }).trim(), '<p>none</p>');
});

test('else binds across comments and whitespace', () => {
  const source = '<p if="ok">y</p>\n  <!-- gap -->\n  <p else>n</p>';
  assert.equal(render(source, { ok: false }).trim(), '<p>n</p>');
});

test('whitespace between branches is consumed, not emitted', () => {
  assert.equal(render('<i if="ok">y</i>\n<i else>n</i>', { ok: true }), '<i>y</i>');
});

test('conditions evaluate as expressions, not strings', () => {
  assert.equal(render('<p if="0">x</p>'), '');
  assert.equal(render('<p if="!items.length">empty</p>', { items: [] }), '<p>empty</p>');
});

test('orphaned else is a compile error', () => {
  assert.throws(() => compile('<p>a</p><p else>b</p>'), /orphaned "else"/);
});

test('if + each on one element is a hard error', () => {
  assert.throws(() => compile('<li if="ok" each="x of xs">${x}</li>'), /both "each" and "if"/);
});

// ---- template -------------------------------------------------------------

test('template carrying a directive is consumed', () => {
  assert.equal(
    render('<template if="ok"><h2>a</h2><p>b</p></template>', { ok: true }),
    '<h2>a</h2><p>b</p>',
  );
});

test('template without a directive is emitted verbatim', () => {
  assert.equal(
    render('<template id="row"><li>${label}</li></template>', { label: 'x' }),
    '<template id="row"><li>x</li></template>',
  );
});

test('templates nest, including inside table structure', () => {
  const source = `
    <template if="rows.length">
      <table><tbody>
        <tr each="row of rows"><template each="cell of row"><td>\${cell}</td></template></tr>
      </tbody></table>
    </template>`;
  const out = render(source, { rows: [['a', 'b'], ['c', 'd']] }).replace(/\s+</g, '<');
  assert.match(out, /<tr><td>a<\/td><td>b<\/td><\/tr><tr><td>c<\/td><td>d<\/td><\/tr>/);
});

// ---- attributes -----------------------------------------------------------

test('false, null and undefined drop the attribute', () => {
  assert.equal(render('<a hidden="${a}" title="${b}" rel="${c}"></a>', { a: false, b: null }), '<a></a>');
});

test('true emits a bare boolean attribute', () => {
  assert.equal(render('<input disabled="${d}">', { d: true }), '<input disabled>');
});

test('mixed attribute values concatenate and drop nullish parts', () => {
  assert.equal(
    render('<a class="btn ${extra}"></a>', { extra: null }),
    '<a class="btn "></a>',
  );
});

test('attribute values are escaped', () => {
  assert.equal(render('<a title="${t}"></a>', { t: '"><script>' }), '<a title="&quot;&gt;&lt;script&gt;"></a>');
});

test('objects and arrays serialize as JSON so the client can read them back', () => {
  assert.equal(render('<x-y tags="${tags}"></x-y>', { tags: ['a', 'b'] }), '<x-y tags="[&quot;a&quot;,&quot;b&quot;]"></x-y>');
});

// ---- components -----------------------------------------------------------

test('a component renders host attrs, a shadow root, and slotted children', () => {
  const components = new Map([['user-card', '/fake/user-card.html']]);
  const { body, components: used } = compileFragment(
    splitBlocks('<user-card name="${who}"><em>hi</em></user-card>').nodes,
    { components, shadowTags: new Set(['user-card']) },
  );
  assert.deepEqual(used, [{ tag: 'user-card', ref: '__C0' }]);

  const def = {
    tag: 'user-card',
    css: 'h3{color:red}',
    propDefs: { name: '' },
    render: (d) => `<h3>${d.name}</h3><slot></slot>`,
    coerce: (p) => rt.coerceProps({ name: '' }, p),
  };
  const fn = new Function(
    '__e', '__a', '__ap', '__str', '__sh', 'html', '__C0', '__d',
    `let __o = '';\n${body}\nreturn __o;`,
  );

  assert.equal(
    fn(rt.escape, rt.attr, rt.attrProp, rt.str, rt.shadow, rt.html, def, { who: 'Ada' }),
    '<user-card name="Ada">' +
      '<template shadowrootmode="open"><style>h3{color:red}</style><h3>Ada</h3><slot></slot></template>' +
      '<em>hi</em>' +
      '</user-card>',
  );
});

// ---- blocks ---------------------------------------------------------------

test('splitBlocks separates server, properties, client and style', () => {
  const blocks = splitBlocks(`
    <script server>export default () => ({ a: 1 });</script>
    <script properties>export default { a: 0 };</script>
    <style>p{color:red}</style>
    <p>hi</p>
    <script>console.log(1);</script>
  `);
  assert.match(blocks.server.code, /export default \(\) =>/);
  assert.match(blocks.properties.code, /export default \{ a: 0 \}/);
  assert.deepEqual(blocks.styles, ['p{color:red}']);
  assert.equal(blocks.client.length, 1);
  assert.match(blocks.client[0].code, /console\.log\(1\)/);
  assert.equal(blocks.nodes.filter((n) => n.tagName).length, 1);
});

test('blocks carry the line they start on', () => {
  const blocks = splitBlocks('<p>a</p>\n\n<script server>\nexport default () => ({});\n</script>');
  assert.equal(blocks.server.line, 3);
});

// ---- prop coercion --------------------------------------------------------

test('attribute strings coerce to the shape of the declared default', () => {
  const defs = { count: 0, open: false, tags: [], label: '' };
  assert.deepEqual(rt.coerceProps(defs, { count: '3', open: '', tags: '["a"]', label: 'x' }), {
    count: 3,
    open: true,
    tags: ['a'],
    label: 'x',
  });
  assert.deepEqual(rt.coerceProps(defs, {}), defs);
  assert.equal(rt.coerceProps(defs, { open: 'false' }).open, false);
});

// ---- export const prototype -----------------------------------------------

const component = (source) =>
  compileComponent(source, { tag: 'x-card', shadow: true, runtime: '/rt.js' }).code;

const INIT = /export async function init/;

test('the retired <script element> block says where its members went', () => {
  assert.throws(
    () => splitBlocks('<script element>export default {};</script>'),
    /export const prototype/,
  );
});

test('members reach the def, and are absent when nothing exports them', () => {
  assert.match(component('<script>export const prototype = { go() {} };</script><p>a</p>'), /go\(\)/);
  assert.match(component('<p>a</p>'), /const __members = \{\};/);
});

test('the prototype is hoisted out of the per-element setup body', () => {
  const code = component('<script>export const prototype = { go() {} };\nhost.x = 1;</script><p>a</p>');
  const members = code.indexOf('const __members =');
  const init = code.search(INIT);

  assert.ok(members !== -1 && members < init, 'members belong to the module, not to init');
  assert.doesNotMatch(code.slice(init), /go\(\)/);
  assert.match(code.slice(init), /host\.x = 1;/);
});

test('a helper the prototype reads is hoisted along with it', () => {
  // Otherwise the hoisted members would refer to a name that stayed behind.
  const code = component(
    `<script>const FORMAT = new Intl.NumberFormat();
export const prototype = { show() { return FORMAT.format(1); } };</script><p>a</p>`,
  );
  const helper = code.indexOf('const FORMAT =');
  assert.ok(helper !== -1 && helper < code.search(INIT), 'the helper came along');
});

test('setup code the prototype does not read stays per element', () => {
  const code = component(
    '<script>const id = 1;\nexport const prototype = { go() {} };</script><p>a</p>',
  );
  assert.match(code.slice(code.search(INIT)), /const id = 1;/);
});

test('a prototype reaching for host is an error, not a silently shared value', () => {
  assert.throws(
    () => component('<script>export const prototype = { go() { return host; } };</script><p>a</p>'),
    /per element/,
  );
});

test('a parameter named host is not a reach for the element', () => {
  // Scopes are tracked, so shadowing is shadowing and not a false alarm.
  assert.doesNotThrow(() =>
    component('<script>export const prototype = { go(host) { return host; } };</script><p>a</p>'),
  );
});

test('a client block still cannot export anything else', () => {
  assert.throws(() => component('<script>export const other = 1;</script><p>a</p>'), /cannot export/);
});

for (const name of ['connectedCallback', 'disconnectedCallback', 'attributeChangedCallback']) {
  test(`${name} in the prototype is a compile error`, () => {
    assert.throws(
      () => component(`<script>export const prototype = { ${name}() {} };</script><p>a</p>`),
      (error) => error instanceof CompileError && error.message.includes(name),
    );
  });
}

test('adoptedCallback is left alone — nothing implements it, so nothing breaks', () => {
  assert.match(
    component('<script>export const prototype = { adoptedCallback() {} };</script><p>a</p>'),
    /adoptedCallback/,
  );
});

test('the client block gets a signal alongside host and shadow', () => {
  assert.match(component('<script>void signal;</script><p>a</p>'), /init\(host, shadow, signal\)/);
});
