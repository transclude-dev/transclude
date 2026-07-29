import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compileComponent,
  compileLayout,
  scopeCss,
  splitBlocks,
  usedComponents,
} from '../src/compiler/index.js';
import { compileFragment } from '../src/compiler/codegen.js';
import { renderDocument } from '../src/document.js';
import * as rt from '../src/runtime/index.js';

const compile = (source, opts = {}) =>
  compileLayout(source, { id: 'root', runtime: '/rt.js', ...opts });

function render(source, data = {}, slots = {}) {
  const { body } = compileFragment(splitBlocks(source).nodes, { page: true, layout: true });
  const fn = new Function(
    '__e', '__a', '__str', '__sh', 'html', '__d', '__slots', '__fragment',
    `let __o = '';\n${body}\nreturn __o;`,
  );
  return fn(rt.escape, rt.attr, rt.str, rt.shadow, rt.html, data, slots, false);
}

/** The named regions a page or layout declares for the level above it. */
function slotsOf(source) {
  const { slots } = compileFragment(splitBlocks(source).nodes, { page: true });
  return Object.fromEntries(
    Object.entries(slots).map(([name, body]) => [
      name,
      new Function(
        '__e', '__a', '__str', '__sh', 'html', '__d', '__fragment',
        `let __o = '';\n${body}\nreturn __o;`,
      )(rt.escape, rt.attr, rt.str, rt.shadow, rt.html, {}, false),
    ]),
  );
}

// ---- the slot -------------------------------------------------------------

test('<slot> in a layout is where the child goes', () => {
  assert.equal(
    render('<main><slot></slot></main>', {}, { default: '<h1>page</h1>' }),
    '<main><h1>page</h1></main>',
  );
});

test('slot fallback renders only when there is no child', () => {
  const source = '<slot><p>nothing here</p></slot>';
  assert.equal(render(source, {}, { default: '<h1>page</h1>' }), '<h1>page</h1>');
  assert.equal(render(source, {}, {}), '<p>nothing here</p>');
});

test('a named slot in a layout is a hole of its own', () => {
  const source = '<main><slot></slot></main><aside><slot name="aside">none</slot></aside>';
  assert.equal(
    render(source, {}, { default: 'body', aside: 'extra' }),
    '<main>body</main><aside>extra</aside>',
  );
  assert.equal(render(source, {}, { default: 'body' }), '<main>body</main><aside>none</aside>');
});

test('a named slot in a component is left alone — the browser assigns it', () => {
  const { body } = compileFragment(splitBlocks('<slot name="aside"></slot>').nodes, { page: false });
  assert.match(body, /<slot name=/);
  assert.doesNotMatch(body, /__slots/);
});

test('a page declares named content with <template slot>', () => {
  const slots = slotsOf('<p>main</p><template slot="aside"><b>side</b></template>');
  assert.deepEqual(slots, { aside: '<b>side</b>' });
});

test('named content does not also appear in the default body', () => {
  const { body } = compileFragment(
    splitBlocks('<p>main</p><template slot="aside"><b>side</b></template>').nodes,
    { page: true },
  );
  assert.doesNotMatch(body, /side/);
});

test('a level reports which slots it consumes, so the rest can travel on', () => {
  const { consumed } = compileFragment(
    splitBlocks('<slot></slot><slot name="aside"></slot>').nodes,
    { page: true, layout: true },
  );
  assert.deepEqual(consumed.sort(), ['aside', 'default']);
});

test('<slot> in a component is untouched, because it is a real shadow DOM slot', () => {
  const { body } = compileFragment(splitBlocks('<slot></slot>').nodes, { page: false });
  assert.match(body, /<slot><\/slot>/);
  assert.doesNotMatch(body, /__slot/);
});

test('a layout with no slot warns — nothing inside it could ever appear', () => {
  assert.match(compile('<div>chrome only</div>').warnings[0], /no <slot>/);
  assert.deepEqual(compile('<div><slot></slot></div>').warnings, []);
});

// ---- head ------------------------------------------------------------------

// These buffers hold generated *code*, so run it rather than pattern-matching
// the emitter's own string escaping.
const run = (code) => new Function(`let __o = '';\n${code}\nreturn __o;`)();

test('title is compiled apart from the rest of the head', () => {
  const out = compileFragment(splitBlocks('<title>Hi</title><meta name="a" content="b">').nodes, {
    page: true,
  });
  assert.equal(out.hasTitle, true);
  assert.equal(run(out.title), '<title>Hi</title>');
  assert.equal(run(out.head), '<meta name="a" content="b">');
  assert.equal(out.body, '');
});

test('a template with no title reports hasTitle false', () => {
  const out = compileFragment(splitBlocks('<p>x</p>').nodes, { page: true });
  assert.equal(out.hasTitle, false);
});

// ---- document assembly -----------------------------------------------------

const level = (name, { title = null, head = '', css = '', slots = {} } = {}) => ({
  css,
  headScript: '',
  hasTitle: title !== null,
  renderTitle: () => `<title>${title}</title>`,
  renderHead: () => head,
  render: (_d, incoming = {}) => ({
    ...incoming,
    default: `<${name}>${incoming.default ?? ''}</${name}>`,
    ...slots,
  }),
});

test('body folds inward-out: page first, then each layout around it', () => {
  const html = renderDocument([level('outer'), level('inner'), level('page')], [{}, {}, {}], {});
  assert.match(html, /<outer><inner><page><\/page><\/inner><\/outer>/);
});

test('the innermost title wins', () => {
  const chain = [level('outer', { title: 'Root' }), level('page', { title: 'Page' })];
  const html = renderDocument(chain, [{}, {}], {});
  assert.match(html, /<title>Page<\/title>/);
  assert.doesNotMatch(html, /<title>Root<\/title>/);
});

test('a page with no title falls back to the layout', () => {
  const chain = [level('outer', { title: 'Root' }), level('page')];
  assert.match(renderDocument(chain, [{}, {}], {}), /<title>Root<\/title>/);
});

test('a slot a layout does not consume travels on to the one above it', () => {
  const outer = {
    css: '',
    hasTitle: false,
    renderTitle: () => '',
    renderHead: () => '',
    render: (_d, incoming) => ({ default: `<outer>${incoming.aside ?? 'empty'}</outer>` }),
  };
  const middle = level('middle');
  const page = level('page', { slots: { aside: 'from the page' } });

  const html = renderDocument([outer, middle, page], [{}, {}, {}], {});
  assert.match(html, /<outer>from the page<\/outer>/);
});

test('head and css accumulate outermost first, so a page can override', () => {
  const chain = [
    level('outer', { head: '<meta name="from" content="layout">', css: 'body{color:red}' }),
    level('page', { head: '<meta name="from" content="page">', css: 'body{color:blue}' }),
  ];
  const html = renderDocument(chain, [{}, {}], {});
  assert.ok(html.indexOf('content="layout"') < html.indexOf('content="page"'));
  assert.ok(html.indexOf('color:red') < html.indexOf('color:blue'));
});

test('no client entry means no module script at all', () => {
  const chain = [level('page')];
  assert.doesNotMatch(renderDocument(chain, [{}], { clientEntry: null }), /<script/);
  assert.match(renderDocument(chain, [{}], { clientEntry: '/x.js' }), /<script type="module" src="\/x\.js">/);
});

// ---- which components a template uses --------------------------------------

const registry = new Map([['user-card', 'a'], ['data-table', 'b'], ['card-list', 'c']]);

test('only the components a template actually mentions are found', () => {
  const used = usedComponents('<div><user-card></user-card><p>x</p></div>', registry);
  assert.deepEqual([...used], ['user-card']);
});

test('components inside <template> are found — the parser hides them on .content', () => {
  const used = usedComponents('<template if="x"><data-table></data-table></template>', registry);
  assert.deepEqual([...used], ['data-table']);
});

test('unknown tags are not components', () => {
  assert.deepEqual([...usedComponents('<my-widget></my-widget>', registry)], []);
});

test('script and style blocks are not scanned for tags', () => {
  const used = usedComponents(
    `<script server>export default () => ({ a: '<user-card>' });</script><p>x</p>`,
    registry,
  );
  assert.deepEqual([...used], []);
});

// ---- light by default, shadow by opt-in ------------------------------------

const element = (source, opts = {}) =>
  compileComponent(source, { tag: 'site-note', runtime: '/rt.js', ...opts });

test('a partial is light, a component is shadow, and the caller says which', () => {
  // The directory decides — one declaration, in one place, visible in the tree.
  assert.match(element('<p><slot></slot></p>').code, /export const light = true;/);
  assert.match(element('<p><slot></slot></p>', { shadow: true }).code, /export const light = false;/);
});

test('a stray shadow root template is an error, not a silent second switch', () => {
  assert.throws(
    () => element('<template shadowrootmode="open"><p>x</p></template>'),
    /has no shadow root. Move it to the components directory/,
  );
  assert.throws(
    () => element('<template shadowrootmode="open"><p>x</p></template>', { shadow: true }),
    /already implied — drop the/,
  );
});

test('a partial scopes its styles to its own tag', () => {
  const out = element('<style>p { margin: 0 }</style><p>x</p>');
  assert.match(out.code, /@scope \(site-note\)/);
});

test('a shadow element keeps its styles for the shadow root', () => {
  const out = element('<style>p { margin: 0 }</style><p>x</p>', { shadow: true });
  assert.doesNotMatch(out.code, /@scope/);
  assert.match(out.code, /export const css = "p \{ margin: 0 \}"/);
});

test('a partial\'s <slot> is a compile-time hole', () => {
  const out = element('<p><slot>fallback</slot></p>');
  assert.match(out.code, /__slots\["default"\]/);
});

test('a component\'s <slot> reaches the browser untouched', () => {
  const out = element('<p><slot></slot></p>', { shadow: true });
  assert.match(out.code, /<slot><\/slot>/);
  assert.doesNotMatch(out.code, /__slots\[/);
});

test('styles are scoped to the tag, which needs no class or hash', () => {
  assert.equal(scopeCss('p { margin: 0 }', 'site-note'), '@scope (site-note) {\n  p { margin: 0 }\n}');
});

test('the donut stops an outer partial reaching into a nested one', () => {
  assert.equal(
    scopeCss('a { color: red }', 'site-nav', ['nav-item', 'nav-menu']),
    '@scope (site-nav) to (site-nav nav-item, site-nav nav-menu) {\n  a { color: red }\n}',
  );
});

test('no styles means no empty @scope block', () => {
  assert.equal(scopeCss('', 'site-note'), '');
});

test('how a usage renders follows the child\'s own declaration', () => {
  const components = new Map([['site-note', 'a'], ['user-card', 'b']]);
  const { body } = compileFragment(
    splitBlocks('<site-note>hi</site-note><user-card></user-card>').nodes,
    { components, shadowTags: new Set(['user-card']) },
  );
  assert.match(body, /__C0\.render\(__C0\.coerce\(/, 'the light one renders inline');
  assert.match(body, /__sh\(__C1/, 'the shadow one gets a declarative shadow root');
});

test('a partial with no children passes an empty slot, not undefined', () => {
  const { body } = compileFragment(splitBlocks('<site-note></site-note>').nodes, {
    components: new Map([['site-note', 'x']]),
  });
  assert.match(body, /\{ default: '' \}/);
});

// ---- the site stylesheet ---------------------------------------------------

test('the document links a stylesheet when there is one, and not when there is not', () => {
  const chain = [level('page')];
  assert.doesNotMatch(renderDocument(chain, [{}], {}), /<link/);
  assert.match(
    renderDocument(chain, [{}], { stylesheet: '/assets/site-abc.css' }),
    /<link rel="stylesheet" href="\/assets\/site-abc\.css">/,
  );
});

test('it comes before anything the compiler generates, so a page can override', () => {
  const chain = [level('page', { css: 'body { color: red }' })];
  const html = renderDocument(chain, [{}], { stylesheet: '/site.css' });
  assert.ok(html.indexOf('/site.css') < html.indexOf('body { color: red }'));
});

// ---- interactivity ---------------------------------------------------------

test('a <script> block becomes init(host, shadow, signal)', () => {
  const { code } = element('<p>x</p><script>host.dataset.ready = "1";</script>');
  assert.match(code, /export async function init\(host, shadow, signal\)/);
  assert.match(code, /host\.dataset\.ready = "1";/);
});

test('an element with no script registers nothing at all', () => {
  const { code, hasScript } = element('<p>x</p>');
  assert.equal(hasScript, false);
  assert.match(code, /define(Light|Component)\(def, null\)/);
});

test('a partial defines through defineLight, a component through defineComponent', () => {
  assert.match(element('<p>x</p><script>host;</script>').code, /defineLight\(def, init\)/);
  assert.match(element('<p>x</p><script>host;</script>', { shadow: true }).code, /defineComponent\(def, init\)/);
});

// ---- <script head> ---------------------------------------------------------

test('a head block is its own kind, not client code', () => {
  const blocks = splitBlocks(
    '<script head>theme();</script><script>behaviour();</script><p>x</p>',
  );
  assert.equal(blocks.head.length, 1);
  assert.match(blocks.head[0].code, /theme\(\)/);
  assert.equal(blocks.client.length, 1);
  assert.match(blocks.client[0].code, /behaviour\(\)/);
});

test('the document puts head scripts before the stylesheet', () => {
  // A <link> blocks the scripts after it, and the point of a head script is to
  // run before anything else.
  const withHead = {
    ...level('page'),
    headScript: '<script>first();</script>',
  };
  const html = renderDocument([withHead], [{}], { stylesheet: '/global.css' });
  assert.ok(html.indexOf('first()') < html.indexOf('/global.css'));
});

test('no head block means nothing emitted', () => {
  const html = renderDocument([level('page')], [{}], {});
  assert.doesNotMatch(html, /<script>/);
});

// ---- properties, generated from <script properties> -----------------------------

test('a camelCase prop maps to a dash-case attribute, as HTML requires', () => {
  assert.equal(rt.attrName('name'), 'name');
  assert.equal(rt.attrName('pageSize'), 'page-size');
  assert.equal(rt.attrName('emptyLabel'), 'empty-label');
});

test('coercion accepts either spelling and answers in prop names', () => {
  const defs = { pageSize: 10, label: '' };
  // the DOM reports the attribute; a template passes what the author wrote
  assert.deepEqual(rt.coerceProps(defs, { 'page-size': '25', label: 'x' }), { pageSize: 25, label: 'x' });
  assert.deepEqual(rt.coerceProps(defs, { pageSize: 25, label: 'x' }), { pageSize: 25, label: 'x' });
});

test('a mapped attribute is not also passed through as a stray key', () => {
  // Before the mapping existed, `page-size` leaked through untouched *and*
  // pageSize fell back to its default.
  const out = rt.coerceProps({ pageSize: 10 }, { 'page-size': '25' });
  assert.deepEqual(Object.keys(out), ['pageSize']);
});

test('writing a property serialises the way coercion expects to read it', () => {
  const defs = { tags: [], count: 0, open: false, label: '' };
  const el = {
    attrs: new Map(),
    setAttribute(n, v) { this.attrs.set(n, v); },
    removeAttribute(n) { this.attrs.delete(n); },
    toggleAttribute(n, on) { on ? this.attrs.set(n, '') : this.attrs.delete(n); },
    getAttribute(n) { return this.attrs.has(n) ? this.attrs.get(n) : null; },
  };

  rt.writeProp(el, 'tags', ['a', 'b'], defs.tags);
  rt.writeProp(el, 'count', 3, defs.count);
  rt.writeProp(el, 'open', true, defs.open);
  rt.writeProp(el, 'label', null, defs.label);

  const read = Object.fromEntries([...el.attrs]);
  assert.deepEqual(rt.coerceProps(defs, read), { tags: ['a', 'b'], count: 3, open: true, label: '' });
});

test('a false boolean removes the attribute rather than writing "false"', () => {
  const el = {
    attrs: new Map(),
    toggleAttribute(n, on) { on ? this.attrs.set(n, '') : this.attrs.delete(n); },
  };
  rt.writeProp(el, 'open', true, false);
  assert.equal(el.attrs.has('open'), true);
  rt.writeProp(el, 'open', false, false);
  assert.equal(el.attrs.has('open'), false);
});
