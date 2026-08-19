import test from 'node:test';
import assert from 'node:assert/strict';

import { splitBlocks, compileComponent, compileLayout, compilePage } from '../src/compiler/index.js';
import { compileFragment, CompileError } from '../src/compiler/codegen.js';
import { VOID } from '../src/compiler/html.js';
import * as rt from '../src/runtime/index.js';

function compile(source, components = new Map()) {
  const blocks = splitBlocks(source);
  return compileFragment(blocks.nodes, { components, page: false });
}

function render(source, data = {}, components = new Map(), fragment = false) {
  const { body } = compile(source, components);
  const fn = new Function(
    '__e', '__a', '__str', '__sh', '__data', 'html', '__d', '__fragment',
    `let __o = '';\n${body}\nreturn __o;`,
  );
  return fn(rt.escape, rt.attr, rt.str, rt.shadow, rt.data, rt.html, data, fragment);
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

test('static text escapes all three of & < >', () => {
  // parse5 hands back decoded text, so anything static has to be re-encoded.
  // Nothing covered this: dropping a `replace` from the escaper broke no test.
  assert.equal(render('<p>a &amp; b</p>'), '<p>a &amp; b</p>');
  assert.equal(render('<p>a &lt; b</p>'), '<p>a &lt; b</p>');
  assert.equal(render('<p>a &gt; b</p>'), '<p>a &gt; b</p>');
});

test('a static attribute escapes & " < and leaves > alone', () => {
  // `>` is legal inside a quoted value and a serializer leaves it, which is why
  // `mergeHead` has to be quote-aware rather than stopping at the first one.
  assert.equal(render('<p title="a &amp; b"></p>'), '<p title="a &amp; b"></p>');
  assert.equal(render('<p title="a &quot; b"></p>'), '<p title="a &quot; b"></p>');
  assert.equal(render('<p title="a &lt; b"></p>'), '<p title="a &lt; b"></p>');
  assert.equal(render('<p title="a &gt; b"></p>'), '<p title="a > b"></p>');
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
  assert.throws(() => compile('<p>a</p><p else>b</p>'), /"else" on <p> has no "if" before it/);
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

// ---- void elements --------------------------------------------------------

// Where HTML lets one of these appear. The parser drops a `<col>` that is not
// in a table and a `<source>` that is not in a media element, so testing them
// inside a `<div>` tests nothing: the tag never reaches the compiler.
const PARENT_OF = {
  col: ['<table><colgroup>', '</colgroup></table>'],
  param: ['<object>', '</object>'],
  source: ['<video>', '</video>'],
  track: ['<video>', '</video>'],
};

// Hoisted into <head> by the compiler, so they never appear in a body.
const HOISTED = new Set(['base', 'link', 'meta']);

// Written out rather than read from `VOID`. A loop over the set under test skips
// whatever was deleted from it and passes, which is what the first version of
// this did: removing `br` broke nothing.
const VOID_TAGS = [
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
];

test('the compiler knows exactly these void elements', () => {
  assert.deepEqual([...VOID].sort(), [...VOID_TAGS].sort());
});

test('a void element is emitted without a closing tag', () => {
  // The list lived in two files and was covered for two of its fourteen
  // entries: removing `br`, `img`, `hr`, `wbr` or `col` from it broke no test
  // at all. Only `input` and `meta` were reached, and only because other tests
  // happened to use them.
  for (const tag of VOID_TAGS) {
    if (HOISTED.has(tag)) continue;
    const [open, close] = PARENT_OF[tag] ?? ['<div>', '</div>'];

    const html = render(`${open}<${tag}>${close}`);

    assert.match(html, new RegExp(`<${tag}>`), `<${tag}> did not survive the parse`);
    assert.doesNotMatch(html, new RegExp(`</${tag}>`), `<${tag}> was given a closing tag`);
  }
});

test('an element that is not void keeps its closing tag', () => {
  // The other half of the same rule. Without this, an empty VOID set passes the
  // test above.
  assert.equal(render('<div><span></span></div>'), '<div><span></span></div>');
  assert.equal(render('<p>${x}</p>', { x: 'hi' }), '<p>hi</p>');
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

// An attribute name is emitted as written, so this was the one interpolation
// mistake that rendered the characters `${…}` into the page instead of failing.
// Four paths reach an attribute, and the two that read the name are covered:
// every element goes through `emitElement`, and `<html>` never does.
test('an interpolation in an attribute name is refused', () => {
  const cases = [
    ['a plain element', '<div ${name}="x"></div>'],
    ['a spread, which parses as a name', '<div ${...attrs}></div>'],
    ['a component', '<user-card ${k}="v"></user-card>'],
    ['inside an each', '<ul><li each="n of ns" ${k}="v">x</li></ul>'],
    ['<html>, read by a second parse', '<html ${a}="b"><p>x</p>'],
  ];

  for (const [what, source] of cases) {
    assert.throws(
      () => compilePage(source, { runtime: '/rt.js' }),
      /interpolates an attribute name/,
      what,
    );
  }
});

test('an interpolated attribute value is still fine', () => {
  assert.equal(
    render('<a href="/n/${id}" data-x="${id}" style="--n: ${id}"></a>', { id: 7 }),
    '<a href="/n/7" data-x="7" style="--n: 7"></a>',
  );
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
    '__e', '__a', '__ap', '__str', '__sh', '__data', 'html', '__C0', '__d', '__fragment',
    `let __o = '';\n${body}\nreturn __o;`,
  );

  assert.equal(
    fn(rt.escape, rt.attr, rt.attrProp, rt.str, rt.shadow, rt.data, rt.html, def, { who: 'Ada' }, false),
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

test('adoptedCallback is left alone, since nothing implements it', () => {
  assert.match(
    component('<script>export const prototype = { adoptedCallback() {} };</script><p>a</p>'),
    /adoptedCallback/,
  );
});

test('the client block gets a signal alongside host and shadow', () => {
  assert.match(
    component('<script>void signal;</script><p>a</p>'),
    /init\(host, shadow, signal, internals\)/,
  );
});

// ---- <script head> attributes ----------------------------------------------
//
// They used to be dropped, which turned `<script head src="/theme.js">` into
// `<script></script>`: no error, no script, nothing to notice.

const headOf = (source) => {
  const { code } = compilePage(`${source}<p>x</p>`, { runtime: '/rt.js', filename: 'p' });
  return JSON.parse(/export const headScript = (".*");/.exec(code)[1]);
};

test('src survives, so an external head script is actually loaded', () => {
  assert.equal(headOf('<script head src="/theme.js"></script>'), '<script src="/theme.js"></script>');
});

test('every other attribute survives too, and `head` itself does not', () => {
  const out = headOf('<script head src="/a.js" type="module" nonce="abc"></script>');
  assert.equal(out, '<script src="/a.js" type="module" nonce="abc"></script>');
  assert.doesNotMatch(out, /\bhead\b/);
});

test('a bare attribute stays bare', () => {
  assert.equal(headOf('<script head defer src="/a.js"></script>'), '<script defer src="/a.js"></script>');
});

test('an inline block is unchanged', () => {
  assert.equal(headOf('<script head>theme();</script>'), '<script>theme();</script>');
});

test('an attribute value is escaped, because this is serialized into markup', () => {
  assert.equal(
    headOf('<script head src="/a.js?a=1&b=2"></script>'),
    '<script src="/a.js?a=1&amp;b=2"></script>',
  );
});

test('src with a body is refused, since the browser would ignore one of them', () => {
  assert.throws(() => headOf('<script head src="/a.js">code()</script>'), /cannot also have a body/);
});

test('an interpolated attribute is refused, since this is emitted before any data', () => {
  assert.throws(() => headOf('<script head src="/${x}.js"></script>'), /cannot interpolate/);
});

// ---- what a light element can re-render -----------------------------------

const elementOf = (source, over = {}) =>
  compileComponent(source, { tag: 'a-a', runtime: '/rt.js', filename: 'a-a', ...over });

const withScript = (markup, props = 'tags: []') =>
  `<script properties>export default { ${props} };</script>${markup}<script>host.id;</script>`;

test('a light element writes text and attributes in place', () => {
  const { code } = elementOf(withScript('<p>${tags}</p>'));
  assert.match(code, /__setText/, 'no binding was compiled');
});

test('a light element cannot rebuild structure, and the error says why', () => {
  // Replacing children would throw away what the caller slotted in and anything
  // the page did to them. A light element does not own its children.
  assert.throws(
    () => elementOf(withScript('<ul><li each="t of tags">${t}</li></ul>')),
    /does not own its own children/,
  );
  assert.throws(
    () => elementOf(withScript('<ul><li each="t of tags">${t}</li></ul>')),
    /export const shadow = true/,
  );
});

test('a shadow element binds the structure instead of calling it volatile', () => {
  // With a boundary the `each` compiles to a block with anchors, so a change is
  // written rather than rebuilt. `volatile` is what the compiler could *not*
  // bind, which is why a light element's list ends up there and this does not.
  const source =
    '<script properties>export default { tags: [] };export const shadow = true;</script>' +
    '<ul><li each="t of tags">${t}</li></ul>';
  const { code } = elementOf(source);

  assert.match(code, /__updateBlock|__blockAt/, 'the list was not bound');
  assert.match(code, /export const volatile = \[\]/);
});

test('an element with no behavior is not held to it, since it never re-renders', () => {
  // It ships nothing, so there is no repaint to refuse.
  const source = '<script properties>export default { tags: [] };</script><ul><li each="t of tags">${t}</li></ul>';
  assert.ok(elementOf(source).code, 'a markup-only element should still compile');
});

test('a name read after a block still binds, because the walk steps over one', () => {
  // The block is rendered once and never rebuilt, which makes what the block
  // itself reads volatile and nothing else. A name after it is written in place
  // like any other. Before this, the walk stopped at the block and every name
  // from there to the end of the template was called structural.
  const { code } = elementOf(withScript('<p if="true">fixed</p><span>${name}</span>', 'name: ""'));
  assert.match(code, /export const volatile = \[\]/);
  assert.match(code, /__afterBlock/, 'the walk did not step over the block');
});

test('what the block itself reads is still refused, and still names shadow', () => {
  assert.throws(
    () => elementOf(withScript('<p if="true">${name}</p>', 'name: ""')),
    /does not own its own children/,
  );
  assert.throws(
    () => elementOf(withScript('<p if="name">fixed</p>', 'name: ""')),
    /export const shadow = true/,
  );
});

test('an element that can never update pays for no anchors', () => {
  // The fence is for the walk. Markup that ships nothing has no walk, so the
  // anchors would be bytes on every page that renders it.
  const markupOnly = '<script properties>export default {};</script><li each="t of [1, 2]">x</li>';
  assert.doesNotMatch(elementOf(markupOnly).code, /<!--\[-->/);
  assert.match(elementOf(withScript('<li each="t of [1, 2]">x</li>')).code, /<!--\[-->/);
});

test('state is held to the same structural rule as a prop', () => {
  // The guard reads what the template could not bind, whatever its name came
  // from. State getting a pass here would be a light element rebuilding.
  const source =
    '<script state>export default { tags: [] };</script>' +
    '<ul><li each="t of tags">${t}</li></ul>';

  assert.throws(() => elementOf(source), /export const shadow = true/);
});

test('state a light element only writes is allowed, and is bound', () => {
  // Bound, not just compiled. Without the binding the accessor would set the
  // value and no node would ever hear about it.
  const source = '<script state>export default { n: 0 };</script>\n<p>${n}</p>';
  const { code } = elementOf(source);

  assert.match(code, /export const light = true;/);
  assert.match(code, /__b\[0\] = __textAt\(/, 'the text was not bound');
});

// ---- reserved names -------------------------------------------------------

test('a server block cannot bind a name the generated module defines', () => {
  // The export check was already here. An import binds a name and exports
  // nothing, so it went straight past and broke inside rolldown instead, with
  // an error naming `virtual:transclude-page/index` rather than anyone's file.
  const shapes = [
    ['an import', 'import { elements } from "./x.js";'],
    ['a const', 'const includes = 1;'],
    ['a function', 'function render() {}'],
    ['a class', 'class client {}'],
    ['a destructured const', 'const { hasTitle } = {};'],
  ];

  for (const [what, statement] of shapes) {
    assert.throws(
      () => compilePage(`<script server>${statement}</script><p>x</p>`, { runtime: '/rt.js' }),
      /declares "[a-zA-Z]+", which the generated module already defines/,
      what,
    );
  }
});

test('a layout is held to the same names', () => {
  assert.throws(
    () =>
      compileLayout('<script server>import { layouts } from "./x.js";</script><slot></slot>', {
        id: 'root',
        runtime: '/rt.js',
      }),
    /declares "layouts"/,
  );
});

test('an alias and an ordinary name are left alone', () => {
  const source =
    '<script server>import { elements as tags } from "./x.js";\nconst total = 1;\n' +
    'export const paths = () => [];\nexport default async () => ({});</script><p>x</p>';

  assert.doesNotThrow(() => compilePage(source, { runtime: '/rt.js' }));
});

test('a top-level script with a src is markup, not a client block', () => {
  // Read as a client block it became an empty one, and the tag was dropped from
  // the page with its `src`. Nothing said so: the page rendered, and the script
  // it asked for was simply not there. A nested one was always markup.
  const source = '<title>x</title>\n<script src="/htmx.min.js" defer></script>\n<p>hi</p>';
  const blocks = splitBlocks(source);

  assert.equal(blocks.client.length, 0, 'there is no code here to compile');
  assert.ok(
    blocks.nodes.some((node) => node.tagName === 'script'),
    'it stays in the markup',
  );

  const { code } = compilePage(source, { runtime: '/rt.js' });
  assert.match(code, /htmx\.min\.js/, 'and reaches the page');
});

test('a top-level script with code is still a client block', () => {
  const blocks = splitBlocks('<p>hi</p>\n<script>document.title = "x";</script>');

  assert.equal(blocks.client.length, 1);
  assert.ok(!blocks.nodes.some((node) => node.tagName === 'script'));
});

// ---- view-transition-name ---------------------------------------------------
//
// A name has to be unique in the document. Repeated, every copy carries the
// same one, and the browser's answer is to run no transition at all: nothing
// throws and nothing is logged, so the page just stops animating. The showcase
// carried this as a comment before it was a compile error.

test('a repeated element may not write out a view-transition-name', () => {
  assert.throws(
    () =>
      compilePage(
        `<ul><li each="p of people" style="view-transition-name: card">\${p.name}</li></ul>`,
        { runtime: '/rt.js' },
      ),
    /view-transition-name/,
  );
});

test('a name derived from the loop is what it is asking for', () => {
  assert.doesNotThrow(() =>
    compilePage(
      `<ul><li each="p of people" style="view-transition-name: card-\${p.slug}">\${p.name}</li></ul>`,
      { runtime: '/rt.js' },
    ),
  );
});

test('the check reaches inside a repeated element, not only its root', () => {
  assert.throws(
    () =>
      compilePage(
        `<ul><li each="p of people"><h2 style="view-transition-name: title">\${p.name}</h2></li></ul>`,
        { runtime: '/rt.js' },
      ),
    /<h2> is repeated/,
  );
});

test('a name outside a loop is left alone, because it is unique already', () => {
  assert.doesNotThrow(() =>
    compilePage(`<h1 style="view-transition-name: heading">Title</h1>`, { runtime: '/rt.js' }),
  );
});

test('none is allowed, because it is the one value safe to repeat', () => {
  // Opting an element out of a transition is the reason to write it, and two
  // elements opting out do not collide.
  assert.doesNotThrow(() =>
    compilePage(`<ul><li each="p of people" style="view-transition-name: none"></li></ul>`, {
      runtime: '/rt.js',
    }),
  );
});

test('an interpolation elsewhere in the style does not excuse a written-out name', () => {
  assert.throws(
    () =>
      compilePage(
        `<ul><li each="p of people" style="color: \${p.color}; view-transition-name: card"></li></ul>`,
        { runtime: '/rt.js' },
      ),
    /view-transition-name/,
  );
});

// ---- script data blocks ----------------------------------------------------
//
// A `<script>` whose type the browser does not run is a data block: an import
// map, JSON-LD, hand-written speculation rules, a template a library reads.
// Every one of them was classified as a client module and compiled, which meant
// swallowed. Found by asking whether a hyperscript `behavior` block would
// survive, which it did not, and neither did anything else of that shape.

test('a script the browser does not execute is markup', () => {
  for (const type of ['application/ld+json', 'importmap', 'speculationrules', 'text/hyperscript']) {
    const source = `<script type="${type}">{"a":1}</script>`;
    const blocks = splitBlocks(source);

    assert.equal(blocks.client.length, 0, `${type} was read as client code`);
    assert.equal(blocks.nodes.length, 1, `${type} did not survive as markup`);
  }
});

test('a data block reaches the page with its contents intact', () => {
  // Raw text, so none of it is escaped and none of it is reformatted.
  assert.equal(
    render('<script type="application/ld+json">{"@type":"Article"}</script>'),
    '<script type="application/ld+json">{"@type":"Article"}</script>',
  );
});

test('a script that is JavaScript is still compiled', () => {
  // The other half. Widening this rule until it caught `type="module"` would
  // stop every client block in the project from being compiled at all.
  for (const open of ['<script>', '<script type="module">', '<script type="text/javascript">']) {
    const blocks = splitBlocks(`${open}console.log(1)<\/script>`);

    assert.equal(blocks.client.length, 1, `${open} stopped being client code`);
    assert.equal(blocks.nodes.length, 0, `${open} was emitted as markup`);
  }
});

test('a marked block wins over its type, so `head` still means head', () => {
  const blocks = splitBlocks('<script head type="text/hyperscript">behavior R end<\/script>');

  assert.equal(blocks.head.length, 1);
  assert.equal(blocks.nodes.length, 0);
});

test('interpolating into a data block is still refused', () => {
  // Being markup does not make it safe. It is raw text, so a value could close
  // the element or the statement it sits in, and the existing guard covers it.
  assert.throws(
    () => compile('<script type="application/ld+json">{"h":"${title}"}<\/script>'),
    /written to the page as code/,
  );
});
