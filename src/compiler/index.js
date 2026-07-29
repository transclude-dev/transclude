// Turns a single .html file into one JS module that serves both renders.

import { parseFragment } from 'parse5';
import { compileFragment, childrenOf, CompileError } from './codegen.js';
import { compileBindings } from './bind.js';
import {
  ScriptError,
  assertModule,
  assertNoCollisions,
  bindDefaultExport,
  toFunctionBody,
} from './script.js';

export { CompileError, ScriptError };

const PAGE_EXPORTS = new Set(['css', 'load', 'render', 'renderHead', 'renderTitle', 'layouts', 'client', 'elements', 'headScript']);
const COMPONENT_EXPORTS = new Set([
  'tag', 'light', 'css', 'elements', 'propDefs', 'propAttrs', 'stateDefs', 'members', 'render',
  'coerce', 'def', 'init', 'define', 'default', 'bind', 'update', 'volatile',
]);

/**
 * Top-level <script>/<style> blocks are pulled out; everything else is template.
 *
 *   <script server>      data loading, page only
 *   <script properties>  defaults + implied types for the element's properties
 *   <script state>       internal reactive state, component only
 *   <script>             client code, and `export const prototype` with it
 *   <style>              scoped to the shadow root (component) or the page
 *
 * Each block carries the line it starts on so parse errors can point back into
 * the .html file rather than into generated output.
 */
export function splitBlocks(source) {
  const doc = parseFragment(source, { sourceCodeLocationInfo: true });
  const out = { server: null, properties: null, state: null, client: [], head: [], styles: [], nodes: [] };

  for (const node of doc.childNodes) {
    if (node.nodeName === 'script') {
      const attrs = new Set((node.attrs ?? []).map((a) => a.name));
      const block = blockOf(node);
      if (attrs.has('server')) out.server = block;
      else if (attrs.has('properties')) out.properties = block;
      else if (attrs.has('props')) {
        throw new CompileError(
          '`<script props>` is now `<script properties>` — a property is what the ' +
            'platform calls it, and what the element actually gets.',
          node,
        );
      }
      // Members used to have a block of their own. They belong with the setup
      // code that calls them, so they moved into it.
      else if (attrs.has('element')) {
        throw new CompileError(
          '`<script element>` is gone. Move its members into `<script>` as ' +
            '`export const prototype = { … }` — the same object, next to the code that uses it.',
          node,
        );
      }
      // `<script state>` is the component's own, not in the document.
      else if (attrs.has('state')) out.state = block;
      // `<script head>` is emitted verbatim into <head>, ahead of everything
      // else. Some things have to run before the body parses — a theme applied
      // before first paint, or a `pagereveal` listener, which fires too early
      // for any script in the body to see.
      else if (attrs.has('head')) out.head.push(block);
      else out.client.push(block);
      continue;
    }
    if (node.nodeName === 'style') {
      out.styles.push(blockOf(node).code);
      continue;
    }
    out.nodes.push(node);
  }

  // Drop the blank lines left behind where the blocks used to be.
  while (out.nodes.length && isBlank(out.nodes[0])) out.nodes.shift();
  while (out.nodes.length && isBlank(out.nodes.at(-1))) out.nodes.pop();

  return out;
}

/**
 * Compiles a partial or a component. Which one it is comes from the directory it
 * lives in — one declaration, in one place, visible in the file tree.
 *
 * A partial is light DOM: styles scoped with `@scope`, markup inline, page CSS
 * reaching it, form controls and label references working because there is no
 * boundary. A component gets a shadow root and everything that follows from it.
 */
export function compileComponent(
  source,
  { tag, shadow = false, components = new Map(), shadowTags = new Set(), runtime, filename = '', nested = [] },
) {
  const blocks = splitBlocks(source);
  const where = (kind) => `${filename || tag}.html <script${kind ? ` ${kind}` : ''}>`;

  const props = blocks.properties
    ? bindDefaultExport(blocks.properties, '__propDefs', where('properties'))
    : { code: 'const __propDefs = {};', exports: [], defaultNode: null };
  assertNoCollisions(props.exports, COMPONENT_EXPORTS, where('properties'));

  const state = blocks.state
    ? bindDefaultExport(blocks.state, '__stateDefs', where('state'))
    : { code: 'const __stateDefs = {};', exports: [], defaultNode: null };
  assertNoCollisions(state.exports, COMPONENT_EXPORTS, where('state'));

  if (blocks.state && !shadow) {
    throw new CompileError(
      `<${tag}> is a partial: it keeps the markup it was served and is never ` +
        `re-rendered, so state would have nothing to update. Move it to the ` +
        `components directory.`,
      blocks.state.node,
    );
  }
  assertDistinct(props.defaultNode, state.defaultNode, tag);

  // Members ride along in the client block: `export const prototype`, hoisted to
  // module scope with anything it reads, because a prototype is shared and the
  // setup body is per element.
  const client = toFunctionBody(blocks.client, where(''), { lift: 'prototype' });
  assertNoLifecycle(client.lifted, where(''));
  const template = compileFragment(blocks.nodes, {
    components,
    shadowTags,
    page: false,
    // A partial's `<slot>` is a compile-time hole, like a layout's. In a shadow
    // root it is a real slot and must reach the browser untouched.
    layout: !shadow,
    // Only a component is ever updated, so only a component pays for anchors.
    blocks: shadow,
    // A fragment emits a component bare and lets it paint itself, so a
    // component's own render is never the thing being asked for a fragment.
    // A partial's is.
    fragments: !shadow,
  });

  const styles = blocks.styles.join('\n').trim();

  // Only a component is ever repainted. A partial keeps the markup it was
  // served, so there is nothing for a binding to update.
  const bindings = shadow
    ? compileBindings(blocks.nodes, {
        components,
        shadowTags,
        blockOf: template.blockOf,
        refs: new Map(template.components.map(({ tag: name, ref }) => [name, ref])),
        // The runtime prepends <style> to the shadow root, so the template's
        // own first node is not at index 0.
        rootOffset: styles ? 1 : 0,
      })
    : null;

  const stray = blocks.nodes.find(
    (node) => node.tagName === 'template' && node.attrs?.some((a) => a.name === 'shadowrootmode'),
  );
  if (stray) {
    throw new CompileError(
      shadow
        ? `<${tag}> is a component, so its shadow root is already implied — drop the ` +
          `<template shadowrootmode> wrapper and write the markup directly`
        : `<${tag}> is a partial and has no shadow root. Move it to the components ` +
          `directory if it needs one.`,
      stray,
    );
  }

  const warnings = [
    ...template.warnings,
    ...unusedProps(props.defaultNode, template.reads, blocks),
  ];

  const code = `
${runtimeImport(runtime)}
${componentImports(template.components, { defines: true })}
${client.imports}
${props.code}
${state.code}
${client.lifted ? client.hoisted : 'const __members = {};'}

export const tag = ${JSON.stringify(tag)};
export const light = ${!shadow};
export const css = ${JSON.stringify(shadow ? styles : scopeCss(styles, tag, nested))};
export const propDefs = __propDefs;
export const propAttrs = ${props.exports.includes('attributes') ? 'attributes' : '{}'};
export const stateDefs = __stateDefs;
export const members = __members;
${elementsExport(template.components)}

export function render(__d, __slots = {}, __fragment = false) {
  let __o = '';
${indent(template.body)}
  return __o;
}

export function coerce(props) {
  return coerceProps(propDefs, props, propAttrs);
}

${template.blockDefs}
${bindingsCode(bindings)}
export const def = {
  tag, light, css, elements, propDefs, propAttrs, stateDefs, members, render, coerce, bind,
  update, volatile,
};
export default def;

export async function init(host, shadow, signal) {
${client.body}
}

// Defining an element defines what it renders. A page's entry lists the whole
// closure up front for first paint, but an element that arrives on its own — in
// a fragment, found by the element watcher — has only itself to start from, and
// a shadow root it paints is out of reach of anything watching the document.
//
// The flag is for the cycle: an element may render itself.
let __defined = false;

export function define() {
  if (__defined) return;
  __defined = true;
  ${shadow ? 'defineComponent' : 'defineLight'}(def, ${client.body.trim() ? 'init' : 'null'});
${template.components.map(({ ref }) => `  ${ref}_define();`).join('\n')}
}
`;

  return {
    code,
    warnings,
    shadow,
    hasScript: Boolean(client.body.trim()),
    components: template.components.map((c) => c.tag),
  };
}

export function compilePage(
  source,
  {
    components = new Map(),
    shadowTags = new Set(),
    runtime,
    filename = 'page',
    layouts = [],
    client = { tags: [], hasScript: false, needed: false },
  },
) {
  const blocks = splitBlocks(source);
  const where = `${filename}.html <script server>`;

  const server = blocks.server
    ? bindDefaultExport(blocks.server, '__load', where)
    : { code: 'const __load = null;', exports: [], imports: [], defaultNode: null };
  assertNoCollisions(server.exports, PAGE_EXPORTS, where);

  const template = compileFragment(blocks.nodes, { components, shadowTags, page: true });

  const code = `
${runtimeImport(runtime)}
${componentImports(template.components)}
${layoutImports(layouts)}
${server.code}

export const css = ${JSON.stringify(blocks.styles.join('\n').trim())};
export const headScript = ${JSON.stringify(headScript(blocks))};
${elementsExport(template.components)}
export const hasTitle = ${template.hasTitle};
export const layouts = [${layouts.map((_, i) => `__L${i}`).join(', ')}];
export const client = ${JSON.stringify(client)};
${regionsExport(template.regions)}

export async function load(ctx) {
  if (typeof __load === 'function') return (await __load(ctx)) ?? {};
  return __load ?? {};
}

export function renderTitle(__d) {
  let __o = '';
${indent(template.title)}
  return __o;
}

export function renderHead(__d) {
  let __o = '';
${indent(template.head)}
  return __o;
}

export function render(__d, __slots = {}, __fragment = false) {
  const __out = {};
${slotBodies(template)}
  return __out;
}
`;

  return { code, warnings: template.warnings, components: template.components.map((c) => c.tag) };
}

/**
 * A layout is a page that renders a hole. `render` receives the slot map its
 * child produced, and returns its own for the level above.
 */
export function compileLayout(source, { id, components = new Map(), shadowTags = new Set(), runtime }) {
  const blocks = splitBlocks(source);
  const where = `${id}/_layout.html <script server>`;

  const server = blocks.server
    ? bindDefaultExport(blocks.server, '__load', where)
    : { code: 'const __load = null;', exports: [], imports: [], defaultNode: null };
  assertNoCollisions(server.exports, PAGE_EXPORTS, where);

  const template = compileFragment(blocks.nodes, {
    components,
    shadowTags,
    page: true,
    layout: true,
  });

  const warnings = [...template.warnings];
  if (!/__slots\[/.test(template.body)) {
    warnings.push('no <slot> — nothing rendered inside this layout would ever appear');
  }

  const code = `
${runtimeImport(runtime)}
${componentImports(template.components)}
${server.code}

export const css = ${JSON.stringify(blocks.styles.join('\n').trim())};
export const headScript = ${JSON.stringify(headScript(blocks))};
${elementsExport(template.components)}
export const hasTitle = ${template.hasTitle};

export async function load(ctx) {
  if (typeof __load === 'function') return (await __load(ctx)) ?? {};
  return __load ?? {};
}

export function renderTitle(__d) {
  let __o = '';
${indent(template.title)}
  return __o;
}

export function renderHead(__d) {
  let __o = '';
${indent(template.head)}
  return __o;
}

export function render(__d, __slots = {}, __fragment = false) {
  const __out = {};
${slotBodies(template)}
  return __out;
}

export default { css, headScript, elements, hasTitle, load, renderTitle, renderHead, render };
`;

  return { code, warnings, components: template.components.map((c) => c.tag) };
}

/**
 * Wraps a light element's styles in `@scope`, rooted at its own tag — a custom
 * element name is already a valid selector, so nothing has to be hashed.
 *
 * The `to` clause is the donut: styles stop at any light element nested inside,
 * so an outer one cannot reach into one it merely contains.
 */
export function scopeCss(css, tag, nested = []) {
  if (!css) return '';
  const limit = nested.length ? ` to (${nested.map((inner) => `${tag} ${inner}`).join(', ')})` : '';
  const indented = css.split('\n').map((line) => (line ? `  ${line}` : line)).join('\n');
  return `@scope (${tag})${limit} {\n${indented}\n}`;
}

/** Component tags a template actually uses — the basis for shipping only those. */
export function usedComponents(source, registry) {
  const found = new Set();

  const walk = (nodes) => {
    for (const node of nodes) {
      if (!node.tagName) continue;
      if (registry.has(node.tagName)) found.add(node.tagName);
      walk(childrenOf(node));
    }
  };

  walk(splitBlocks(source).nodes);
  return found;
}

/**
 * Browser entry: define every component, then run the page's own client code.
 * This one is a real module, so the client block keeps its imports and may use
 * top-level await — it only gets validated, not rewritten.
 *
 * `elements` adds the loader for everything else: the page's own tags are
 * imported statically and defined before first paint, and any other tag in the
 * app is one dynamic import away, taken only if it ever shows up in the DOM.
 */
export function compileClientEntry(sources, { tags = [] } = {}, { runtime, elements = false } = {}) {
  // Layouts first, page last: the same order they wrap in.
  const blocks = sources.map(({ source, filename }) =>
    assertModule(splitBlocks(source).client, `${filename} <script>`),
  );

  // Markup can arrive after the page did — from a swapper this framework does
  // not provide — and whatever it names has to be able to define itself.
  const imports = elements
    ? `import { watch as __watch } from ${JSON.stringify(runtime)};\n` +
      `import { elements as __elements } from ${JSON.stringify(ELEMENTS_ENTRY)};`
    : '';

  const start = elements ? '__watch(__elements);' : '';

  return {
    code: `
${imports}
${tags.map((tag, i) => `import { define as __D${i} } from ${JSON.stringify(`virtual:hf-component/${tag}`)};`).join('\n')}

${tags.map((_, i) => `__D${i}();`).join('\n')}
${start}

${blocks.join('\n')}
`,
  };
}

/** The id of the module `compileClientEntry` reaches for when `elements` is on. */
export const ELEMENTS_ENTRY = 'virtual:hf-elements';

/**
 * tag -> dynamic import, for every element in the app.
 *
 * A thunk rather than a URL: the bundler is the only thing that knows where the
 * chunk lands, and `import()` is how you ask it. Nothing has to be written into
 * a manifest, threaded through the server, or kept in sync with a hash.
 */
export function compileElementsEntry(tags) {
  const entries = [...tags]
    .sort()
    .map(
      (tag) =>
        `  ${JSON.stringify(tag)}: () => import(${JSON.stringify(`virtual:hf-component/${tag}`)}),`,
    );
  return { code: `export const elements = {\n${entries.join('\n')}\n};\n` };
}

/**
 * `bind` finds the node behind every expression the compiler could place, once;
 * `update` writes to them. `volatile` is the honest part: prop names whose
 * change needs a full repaint because nothing here can reach them.
 *
 * A partial gets the same shape with nothing in it, so the runtime does not
 * have to ask whether it exists.
 */
function bindingsCode(bindings) {
  if (!bindings) {
    return [
      'export function bind() { return null; }',
      'export function update() { return false; }',
      'export const volatile = [];',
    ].join('\n');
  }
  return [
    'export function bind(__root, __d) {',
    '  const __b = [];',
    bindings.cursors
      ? `  let ${Array.from({ length: bindings.cursors }, (_, i) => `__c${i}`).join(', ')};`
      : '',
    indent(bindings.locate),
    '  return __b;',
    '}',
    '',
    'export function update(__b, __d) {',
    '  let __ok = true;',
    indent(bindings.writes),
    '  return __ok;',
    '}',
    '',
    bindings.parts,
    `export const volatile = ${JSON.stringify(bindings.volatile)};`,
  ].join('\n');
}

// Overwriting these on the prototype replaces the framework's own, and the
// element silently stops rendering. `adoptedCallback` is not among them: nothing
// implements it, so there is nothing to break.
const RESERVED_LIFECYCLE = {
  connectedCallback: 'setup belongs in the <script> body, which runs on connect',
  disconnectedCallback: 'return a cleanup function from the <script> body instead',
  attributeChangedCallback: 'an attribute change already re-renders; use updated() for the side effect',
};

/** The keys of an `export default { … }`, where it is a plain object literal. */
function objectKeys(defaultNode) {
  if (defaultNode?.type !== 'ObjectExpression') return [];
  return defaultNode.properties
    .filter((prop) => prop.type === 'Property' && !prop.computed)
    .map((prop) => (prop.key.type === 'Identifier' ? prop.key.name : String(prop.key.value)));
}

/**
 * Props and state share one namespace in the template — `${open}` cannot say
 * which it meant — so a name can only belong to one of them.
 */
function assertDistinct(propsNode, stateNode, tag) {
  const declared = new Set(objectKeys(propsNode));
  for (const key of objectKeys(stateNode)) {
    if (declared.has(key)) {
      throw new CompileError(
        `<${tag}>: \`${key}\` is declared in both <script properties> and <script state>. ` +
          `A template reads them from one namespace, so the name has to be one or the other.`,
        stateNode,
      );
    }
  }
}

function assertNoLifecycle(defaultNode, label) {
  if (defaultNode?.type !== 'ObjectExpression') return;

  for (const prop of defaultNode.properties) {
    if (prop.type !== 'Property' || prop.computed) continue;
    const name = prop.key.type === 'Identifier' ? prop.key.name : String(prop.key.value);
    const advice = RESERVED_LIFECYCLE[name];
    if (advice) {
      throw new CompileError(`${label}: \`${name}\` is the framework's — ${advice}`, prop);
    }
  }
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A prop nobody reads is usually a rename that only got half done. A prop can
 * legitimately never appear in the template — `compact` drives `:host([compact])`
 * in CSS and is toggled from the client block — so a plain word match against
 * <style> and <script> is what keeps this quiet enough to leave on.
 */
function unusedProps(defaultNode, reads, blocks) {
  if (defaultNode?.type !== 'ObjectExpression') return [];

  const declared = [];
  for (const prop of defaultNode.properties) {
    if (prop.type !== 'Property' || prop.computed) return [];
    if (prop.key.type === 'Identifier') declared.push(prop.key.name);
    else if (prop.key.type === 'Literal') declared.push(String(prop.key.value));
  }

  const elsewhere = [...blocks.styles, ...blocks.client.map((b) => b.code)].join('\n');

  return declared
    .filter((name) => !reads.has(name))
    .filter((name) => !new RegExp(`\\b${escapeRegExp(name)}\\b`).test(elsewhere))
    .map(
      (name) =>
        `prop \`${name}\` is declared but never used — it is not read in the template, ` +
        `and does not appear in <style> or <script>`,
    );
}

// ---- module assembly helpers ---------------------------------------------

function runtimeImport(runtime) {
  return `import { escape as __e, attr as __a, attrProp as __ap, str as __str, shadow as __sh, textAt as __textAt, setText as __setText, setParts as __setParts, setAttr as __setAttr, setAttrProp as __setAttrProp, blockAt as __blockAt, updateBlock as __updateBlock, coerceProps, defineComponent, defineLight, html } from ${JSON.stringify(runtime)};`;
}

function layoutImports(layouts) {
  return layouts
    .map((layout, i) => `import __L${i} from ${JSON.stringify(`virtual:hf-layout/${layout.id}`)};`)
    .join('\n');
}

/**
 * `defines` pulls each nested element's `define` in alongside its def, so a
 * component can register the elements it renders. Only a component needs that —
 * a page or layout never renders itself into a document that has not already
 * loaded its entry.
 */
function componentImports(used, { defines = false } = {}) {
  return used
    .map(({ tag, ref }) => {
      const from = JSON.stringify(`virtual:hf-component/${tag}`);
      const named = defines ? `, { define as ${ref}_define }` : '';
      return `import ${ref}${named} from ${from};`;
    })
    .join('\n');
}

/**
 * A light element's styles are hoisted into <head> once, so every level exports
 * the elements it pulled in. Nested ones come along through their own export,
 * and the document dedupes by tag.
 */
/** `<script head>` blocks, verbatim, in the order they were written. */
function headScript(blocks) {
  return blocks.head.map((block) => `<script>${block.code}</script>`).join('\n');
}

function elementsExport(used) {
  return `export const elements = [${used.map(({ ref }) => ref).join(', ')}];`;
}

/**
 * Each `[fragment]` region as a function of the page's own data. The same markup
 * the document got, so a swap cannot drift from the page it replaces part of.
 */
function regionsExport(regions) {
  const entries = Object.entries(regions ?? {});
  if (!entries.length) return 'export const regions = {};';

  const bodies = entries.map(
    ([name, body]) =>
      `  ${JSON.stringify(name)}: (__d, __slots = {}, __fragment = true) => {\n` +
      `    let __o = '';\n${indent(indent(body))}\n    return __o;\n  },`,
  );
  return `export const regions = {\n${bodies.join('\n')}\n};`;
}

function blockOf(node) {
  const text = node.childNodes[0];
  return {
    code: text?.value ?? '',
    line: text?.sourceCodeLocation?.startLine ?? node.sourceCodeLocation?.startTag?.endLine ?? 1,
    offset: text?.sourceCodeLocation?.startOffset ?? node.sourceCodeLocation?.startTag?.endOffset ?? 0,
  };
}

/**
 * Every level renders to a map of slots, not a string: `default` is its own
 * content, and any `<template slot="x">` it declared is content for the level
 * above. One shape for pages and layouts alike keeps the fold uniform.
 */
function slotBodies(template) {
  // A slot this level does not render belongs to one further out, so it is
  // handed on rather than dropped — otherwise a page could only ever fill a
  // slot in its nearest layout.
  const consumed = JSON.stringify([...(template.consumed ?? []), 'default']);
  const parts = [
    `  const __pass = new Set(${consumed});`,
    `  for (const __name in __slots) if (!__pass.has(__name)) __out[__name] = __slots[__name];`,
    `  {\n    let __o = '';\n${indent(indent(template.body))}\n    __out.default = __o;\n  }`,
  ];

  for (const [name, body] of Object.entries(template.slots ?? {})) {
    parts.push(
      `  {\n    let __o = '';\n${indent(indent(body))}\n    __out[${JSON.stringify(name)}] = __o;\n  }`,
    );
  }
  return parts.join('\n');
}

function indent(code) {
  return code
    .split('\n')
    .map((line) => (line ? `  ${line}` : line))
    .join('\n');
}

function isBlank(node) {
  return node.nodeName === '#text' && /^\s*$/.test(node.value ?? '');
}
