// Fragment render mode.
//
// A fragment is markup for a document that already exists. Nothing that swaps
// HTML into a live page processes a declarative shadow root, so a component in
// a fragment ships bare and paints itself on connect. Everything else renders the
// way it always did: the light DOM, the partials, the attributes.

import test from 'node:test';
import assert from 'node:assert/strict';

import { parse } from 'acorn';

import { splitBlocks, compileComponent } from '../src/compiler/index.js';
import { compileFragment } from '../src/compiler/codegen.js';
import * as rt from '../src/runtime/index.js';

/**
 * Every framework-generated name a module mentions but never binds.
 *
 * The generated module is never run by the unit tests, because it is a real ESM
 * module with imports, so a name emitted into a scope that does not have it
 * survives every assertion here and fails at build time instead. This is the check that
 * moves that failure forward. Only `__` names are considered: those are the
 * compiler's own, and the author's are their business.
 */
function unbound(code) {
  const ast = parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
  const free = new Set();

  const names = (node) =>
    node?.type === 'Identifier'
      ? [node.name]
      : node?.type === 'ObjectPattern'
        ? node.properties.flatMap((p) => names(p.value ?? p.argument))
        : node?.type === 'ArrayPattern'
          ? node.elements.filter(Boolean).flatMap(names)
          : node?.type === 'AssignmentPattern'
            ? names(node.left)
            : node?.type === 'RestElement'
              ? names(node.argument)
              : [];

  const declared = (body) =>
    (body ?? []).flatMap((node) => {
      const decl = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
      if (decl?.type === 'VariableDeclaration') return decl.declarations.flatMap((d) => names(d.id));
      if (decl?.type === 'FunctionDeclaration' || decl?.type === 'ClassDeclaration') return [decl.id.name];
      if (node.type === 'ImportDeclaration') return node.specifiers.map((s) => s.local.name);
      return [];
    });

  const walk = (node, bound) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((child) => walk(child, bound));
    if (typeof node.type !== 'string') return;

    if (node.type === 'Identifier') {
      if (node.name.startsWith('__') && !bound.has(node.name)) free.add(node.name);
      return;
    }
    if (node.type === 'MemberExpression') {
      walk(node.object, bound);
      if (node.computed) walk(node.property, bound);
      return;
    }
    if (node.type === 'Property') {
      if (node.computed) walk(node.key, bound);
      return walk(node.value, bound);
    }
    if (/Function(Declaration|Expression)$|ArrowFunctionExpression/.test(node.type)) {
      const inner = new Set([...bound, ...node.params.flatMap(names)]);
      if (node.id) inner.add(node.id.name);
      if (node.body.type === 'BlockStatement') declared(node.body.body).forEach((n) => inner.add(n));
      node.params.forEach((p) => walk(p, inner));
      return walk(node.body, inner);
    }
    if (node.type === 'BlockStatement') {
      const inner = new Set([...bound, ...declared(node.body)]);
      return node.body.forEach((child) => walk(child, inner));
    }
    if (/^For(Of|In)?Statement$/.test(node.type)) {
      const head = node.init ?? node.left;
      const inner = new Set(bound);
      if (head?.type === 'VariableDeclaration') {
        head.declarations.forEach((d) => names(d.id).forEach((name) => inner.add(name)));
      }
      for (const key of ['init', 'left', 'right', 'test', 'update', 'body']) {
        if (node[key]) walk(node[key], inner);
      }
      return;
    }
    if (node.type === 'CatchClause') {
      const inner = new Set([...bound, ...names(node.param)]);
      return walk(node.body, inner);
    }
    for (const key of Object.keys(node)) {
      if (['type', 'start', 'end', 'loc', 'range'].includes(key)) continue;
      walk(node[key], bound);
    }
  };

  walk(ast, new Set(declared(ast.body)));
  return [...free];
}

/**
 * Compiles a template to the function the generated module would have wrapped,
 * with the component refs bound to real defs. The compiled body is what is being
 * tested. Writing it out by hand would test nothing.
 */
function templateOf(source, registry = new Map(), opts = {}) {
  const components = new Map([...registry.keys()].map((tag, i) => [tag, `/c${i}.js`]));
  const shadowTags = new Set([...registry].filter(([, def]) => !def.light).map(([tag]) => tag));
  const { body, components: used } = compileFragment(splitBlocks(source).nodes, {
    components,
    shadowTags,
    ...opts,
  });

  const fn = new Function(
    '__e', '__a', '__ap', '__str', '__sh', '__data', 'html', '__d', '__slots', '__fragment',
    ...used.map(({ ref }) => ref),
    `let __o = '';\n${body}\nreturn __o;`,
  );

  return (data = {}, slots = {}, fragment = false) =>
    fn(
      rt.escape, rt.attr, rt.attrProp, rt.str, rt.shadow, rt.data, rt.html,
      data, slots, fragment,
      ...used.map(({ tag }) => registry.get(tag)),
    );
}

const defOf = (over) => ({
  propAttrs: {},
  coerce(props) {
    return rt.coerceProps(this.propDefs, props, this.propAttrs);
  },
  ...over,
});

const CARD = defOf({
  tag: 'user-card',
  light: false,
  css: ':host{display:block}',
  propDefs: { name: '' },
  render: (d, slots = {}) => `<h3>${rt.escape(d.name)}</h3>${slots.default ?? ''}`,
});

const NOTE = defOf({
  tag: 'site-note',
  light: true,
  css: '@scope (site-note) { p { margin: 0 } }',
  propDefs: { tone: 'neutral' },
  render: templateOf('<p class="${tone}"><slot></slot></p>', new Map(), { layout: true }),
});

const cards = new Map([['user-card', CARD]]);
const notes = new Map([['site-note', NOTE]]);

// ---- components -----------------------------------------------------------

test('a component keeps its declarative shadow root in a document', () => {
  const html = templateOf('<user-card name="Ada"></user-card>', cards)();

  assert.match(html, /<template shadowrootmode="open">/);
  assert.match(html, /<h3>Ada<\/h3>/);
});

test('a component ships bare in a fragment', () => {
  const html = templateOf('<user-card name="Ada"></user-card>', cards)({}, {}, true);

  assert.equal(html, '<user-card name="Ada"></user-card>');
});

test('its attributes survive, since they are all the client re-renders from', () => {
  const html = templateOf('<user-card name="${who}"></user-card>', cards)({ who: 'Grace' }, {}, true);

  assert.equal(html, '<user-card name="Grace"></user-card>');
});

test('light children still render, because they are slot content', () => {
  const html = templateOf('<user-card name="Ada"><em>hi</em></user-card>', cards)({}, {}, true);

  assert.equal(html, '<user-card name="Ada"><em>hi</em></user-card>');
});

test('the styles go with the shadow root that is no longer there', () => {
  const html = templateOf('<user-card name="Ada"></user-card>', cards)({}, {}, true);

  assert.doesNotMatch(html, /display:block/, 'shadow styles belong to the shadow root');
});

// ---- partials -------------------------------------------------------------

test('a partial renders the same either way, having no shadow root to skip', () => {
  const render = templateOf('<site-note tone="warn">careful</site-note>', notes);

  assert.equal(render(), render({}, {}, true));
  assert.match(render({}, {}, true), /<p class="warn">careful<\/p>/);
});

// ---- the flag has to reach all the way down -------------------------------

test('a component inside a partial is bare too', () => {
  // The partial's own render is a separate compiled function. If the flag stops
  // at the page, a component one level down still emits a shadow root that
  // nothing will ever process.
  const nested = defOf({
    tag: 'site-note',
    light: true,
    propDefs: {},
    render: templateOf('<p><user-card name="Ada"></user-card></p>', cards, { layout: true }),
  });
  const render = templateOf('<site-note></site-note>', new Map([['site-note', nested]]));

  assert.match(render(), /shadowrootmode/, 'a document still gets the shadow root');
  assert.equal(render({}, {}, true), '<site-note><p><user-card name="Ada"></user-card></p></site-note>');
});

test('a component inside a block inside a fragment is bare', () => {
  const render = templateOf('<user-card each="n of names" name="${n}"></user-card>', cards, {
    blocks: false,
  });

  assert.equal(
    render({ names: ['Ada', 'Grace'] }, {}, true),
    '<user-card name="Ada"></user-card><user-card name="Grace"></user-card>',
  );
});

// ---- the runtime entry ----------------------------------------------------

test('fragment() renders a partial for insertion', () => {
  assert.equal(rt.fragment(NOTE, { tone: 'warn' }, { default: 'careful' }), '<p class="warn">careful</p>');
});

test('fragment() leaves the styles out, since they are hoisted per page', () => {
  assert.doesNotMatch(rt.fragment(NOTE, {}), /@scope|<style>/, 'a copy per swap would stack up');
});

// ---- the generated module has to close over everything it names ------------

test('a component with a block full of components binds every name it uses', () => {
  // `each` in a component compiles to its own module-scope function. A flag
  // threaded in from render is not in scope there, and nothing that runs in
  // this file would notice, because the module is real ESM and never runs.
  const { code } = compileComponent(
    `<script element>
  export const properties = { people: [] };
</script>
<ul><li each="p of people" key="p.name"><user-card name="\${p.name}"></user-card></li></ul>`,
    {
      tag: 'card-list',
      shadow: true,
      runtime: '/rt.js',
      components: new Map([['user-card', '/c.js']]),
      shadowTags: new Set(['user-card']),
    },
  );

  assert.deepEqual(unbound(code), []);
});

test('a partial with the same markup binds every name too', () => {
  const { code } = compileComponent(
    `<script element>
  export const properties = { people: [] };
</script>
<ul><li each="p of people"><user-card name="\${p.name}"></user-card></li></ul>`,
    {
      tag: 'card-row',
      shadow: false,
      runtime: '/rt.js',
      components: new Map([['user-card', '/c.js']]),
      shadowTags: new Set(['user-card']),
    },
  );

  assert.deepEqual(unbound(code), []);
});

test('shadow() is what decides, so the mode cannot be half-applied', () => {
  assert.equal(rt.shadow(CARD, { name: 'Ada' }, true), '');
  assert.match(rt.shadow(CARD, { name: 'Ada' }), /^<template shadowrootmode="open">/);
});
