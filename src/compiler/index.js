// Turns a single .html file into one JS module that serves both renders.

import { parse, parseFragment } from 'parse5';
import { compileFragment, childrenOf, CompileError } from './codegen.js';
import { lineMap, sourceMap } from './sourcemap.js';
import { compileBindings } from './bind.js';
import {
  ScriptError,
  assertModule,
  assertNoActionsObject,
  assertNoCollisions,
  bindDefaultExport,
  toFunctionBody,
} from './script.js';

export { CompileError, ScriptError };

const PAGE_EXPORTS = new Set(['css', 'load', 'render', 'renderHead', 'renderTitle', 'renderHtmlAttrs', 'layouts', 'client', 'elements', 'headScript']);
const COMPONENT_EXPORTS = new Set([
  'tag', 'light', 'css', 'elements', 'propDefs', 'propAttrs', 'stateDefs', 'members', 'render',
  'coerce', 'def', 'init', 'define', 'default', 'bind', 'update', 'volatile', 'formAssociated',
]);

/**
 * What an element may declare about itself, in `<script properties>` or in
 * `<script>`. Neither is a prop and neither is setup code: each decides
 * something about the tag, the same for every element of it.
 *
 * `shadow` decides how the tag renders, so it is read before anything is
 * compiled: every other file mentioning the tag compiles differently for it.
 */
export const ELEMENT_FLAGS = ['shadow', 'formAssociated'];

/**
 * One value per flag, from whichever block declared it.
 *
 * Declaring one twice is refused rather than resolved. Two homes for one fact
 * leaves nothing to say which is right when they disagree.
 */
function resolveFlags(fromProps = {}, fromClient = {}, tag) {
  const out = {};

  for (const flag of ELEMENT_FLAGS) {
    const a = fromProps[flag] ?? null;
    const b = fromClient[flag] ?? null;

    if (a !== null && b !== null) {
      throw new ScriptError(
        `<${tag}> declares \`${flag}\` in both <script properties> and <script>. ` +
          `Keep the one that reads better and delete the other.`,
      );
    }
    out[flag] = a ?? b;
  }

  return out;
}

/**
 * An element's flags, read without compiling it.
 *
 * The plugin needs `shadow` before it can compile anything, because how a tag
 * renders decides how every other file that mentions it compiles. Same blocks
 * and the same extractor as the compile itself, so there is one answer.
 *
 * @param {string} source the whole .html file
 * @param {string} [label] what to call it in an error
 * @returns {Record<string, boolean>} one entry per `ELEMENT_FLAGS` name
 */
export function readFlags(source, label = 'element') {
  const blocks = splitBlocks(source);

  const fromProps = blocks.properties
    ? bindDefaultExport(blocks.properties, '__probe', `${label} <script properties>`, {
        flags: ELEMENT_FLAGS,
      }).flags
    : {};
  const fromClient = toFunctionBody(blocks.client, `${label} <script>`, {
    lift: 'prototype',
    flags: ELEMENT_FLAGS,
  }).flags;

  return resolveFlags(fromProps, fromClient, label);
}

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
 *
 * @param {string} source
 * @returns {object} the script blocks, the styles, the markup nodes and the
 *   `<html>` element read from a second parse
 */
export function splitBlocks(source) {
  const doc = parseFragment(source, { sourceCodeLocationInfo: true });

  // A second parse, in document mode, only to read `<html>`. The fragment parser
  // above drops it: a nested html start tag cannot appear in a body, so it goes
  // away with its attributes. In document mode it is the element it names, and a
  // `<html>` inside a script block or a comment is still not one, because this
  // is the real parser rather than a search for a string.
  const html =
    parse(source, { sourceCodeLocationInfo: true }).childNodes.find((n) => n.nodeName === 'html') ??
    null;
  const out = { server: null, properties: null, state: null, client: [], head: [], styles: [], nodes: [], html };

  for (const node of doc.childNodes) {
    if (node.nodeName === 'script') {
      const attrs = new Set((node.attrs ?? []).map((a) => a.name));
      const block = blockOf(node);
      if (attrs.has('server')) out.server = block;
      else if (attrs.has('properties')) out.properties = block;
      else if (attrs.has('props')) {
        throw new CompileError(
          '`<script props>` is now `<script properties>`. A property is what the ' +
            'platform calls it, and what the element gets.',
          node,
        );
      }
      // Members used to have a block of their own. They belong with the setup
      // code that calls them, so they moved into it.
      else if (attrs.has('element')) {
        throw new CompileError(
          '`<script element>` is gone. Move its members into `<script>` as ' +
            '`export const prototype = { … }`. The same object, next to the code that uses it.',
          node,
        );
      }
      // `<script state>` is the component's own, not in the document.
      else if (attrs.has('state')) out.state = block;
      // `<script head>` is emitted verbatim into <head>, ahead of everything
      // else. Some things have to run before the body parses: a theme applied
      // before first paint, or a `pagereveal` listener, which fires too early for
      // any script in the body to see.
      else if (attrs.has('head')) out.head.push({ ...block, attrs: node.attrs ?? [] });
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
 * Compiles one element. `export const shadow = true` in the file decides which
 * kind it is, so the file answers for itself.
 *
 * Light is the default: styles scoped with `@scope`, markup inline, page CSS
 * reaching it, and form controls and `<label for>` working because there is no
 * boundary. A shadow root is the opt-in, with everything that follows from it.
 */
export function compileComponent(
  source,
  { tag, shadow = false, components = new Map(), shadowTags = new Set(), runtime, filename = '', nested = [] },
) {
  const blocks = splitBlocks(source);
  const where = (kind) => `${filename || tag}.html <script${kind ? ` ${kind}` : ''}>`;

  // A flag is a fact about the element rather than a prop or a piece of setup,
  // so either block can carry it. An element that only needs one would otherwise
  // need a block holding nothing else.
  const props = blocks.properties
    ? bindDefaultExport(blocks.properties, '__propDefs', where('properties'), { flags: ELEMENT_FLAGS })
    : { code: 'const __propDefs = {};', exports: [], defaultNode: null, flags: {} };
  assertNoCollisions(props.exports, COMPONENT_EXPORTS, where('properties'));

  // Members ride along in the client block: `export const prototype`, hoisted to
  // module scope with anything it reads, because a prototype is shared and the
  // setup body is per element.
  const client = toFunctionBody(blocks.client, where(''), { lift: 'prototype', flags: ELEMENT_FLAGS });
  assertNoLifecycle(client.lifted, where(''));

  const flags = resolveFlags(props.flags, client.flags, tag);
  const formAssociated = flags.formAssociated ?? false;
  // The file decides. `shadow` is still an argument so a caller can compile one
  // element on its own, but a file that says which it is always wins.
  const isShadow = flags.shadow ?? shadow;

  const state = blocks.state
    ? bindDefaultExport(blocks.state, '__stateDefs', where('state'))
    : { code: 'const __stateDefs = {};', exports: [], defaultNode: null };
  assertNoCollisions(state.exports, COMPONENT_EXPORTS, where('state'));

  assertDistinct(props.defaultNode, state.defaultNode, tag);

  // Whether this element is registered at all. A light element with no behavior
  // is markup that was already rendered and ships nothing, so it can never see
  // an attribute change and has nothing to update. Anchors would be bytes on
  // every page that pay for a repaint that cannot happen.
  const defined =
    isShadow ||
    Boolean(client.body.trim()) ||
    client.lifted !== null ||
    formAssociated === true ||
    Boolean(blocks.state);

  const template = compileFragment(blocks.nodes, {
    components,
    shadowTags,
    page: false,
    // A light element's `<slot>` is a compile-time hole, like a layout's. In a
    // shadow root it is a real slot and must reach the browser untouched.
    layout: !isShadow,
    // Anchors are what an update writes through, so every element that can be
    // updated needs them and no other element should carry them.
    blocks: defined,
    // A fragment emits a shadow element bare and lets it paint itself, so its
    // own render is never what a fragment asks for. A light element's is.
    fragments: !isShadow,
  });

  const styles = blocks.styles.join('\n').trim();

  const bindings = defined
    ? compileBindings(blocks.nodes, {
        components,
        shadowTags,
        blockOf: template.blockOf,
        refs: new Map(template.components.map(({ tag: name, ref }) => [name, ref])),
        // The runtime prepends <style> to the shadow root, so a component's own
        // first node is not at index 0. A light element's styles are hoisted
        // into <head>, so its root starts where the template does.
        rootOffset: isShadow && styles ? 1 : 0,
      })
    : null;

  // A light element updates the nodes it already has: text and attributes are
  // written in place, which never touches what the caller slotted in. Structure
  // is different. Rebuilding an `if` or an `each` means replacing children, and a
  // light element does not own its children: the page's CSS reaches them, the
  // page's script can hold them, and the caller's slotted markup sits among them.
  // A shadow root is what makes that subtree the element's to replace.
  const volatileProps = bindings?.volatile ?? [];
  if (!isShadow && volatileProps.length) {
    throw new CompileError(
      `<${tag}> re-renders \`${volatileProps.join('`, `')}\` by rebuilding structure, ` +
        `which a light element cannot do: it does not own its own children. ` +
        `Add \`export const shadow = true\`, or move the \`if\` or \`each\` to the page.`,
      blocks.nodes[0] ?? null,
    );
  }

  const stray = blocks.nodes.find(
    (node) => node.tagName === 'template' && node.attrs?.some((a) => a.name === 'shadowrootmode'),
  );
  if (stray) {
    throw new CompileError(
      isShadow
        ? `<${tag}> is a component, so it already has a shadow root. Drop the ` +
          `<template shadowrootmode> wrapper and write the markup directly`
        : `<${tag}> is a partial and has no shadow root. Move it to the components ` +
          `directory if it needs one.`,
      stray,
    );
  }

  const warnings = [
    ...template.warnings,
    ...client.warnings,
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
export const light = ${!isShadow};
export const formAssociated = ${formAssociated === true};
export const css = ${JSON.stringify(isShadow ? styles : scopeCss(styles, tag, nested))};
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
  update, volatile, formAssociated,
};
export default def;

export async function init(host, shadow, signal, internals) {
${client.body}
}

// Defining an element defines what it renders. A page's entry lists the whole
// set up front for first paint. An element that arrives on its own, in a fragment
// found by the element watcher, has only itself to start from, and a shadow root
// it paints is out of reach of anything watching the document.
//
// The flag is for the cycle: an element may render itself.
let __defined = false;

export function define() {
  if (__defined) return;
  __defined = true;
  ${isShadow ? 'defineComponent' : 'defineLight'}(def, ${client.body.trim() ? 'init' : 'null'});
${template.components.map(({ ref }) => `  ${ref}_define();`).join('\n')}
}
`;

  return {
    code,
    warnings,
    isShadow,
    hasScript: Boolean(client.body.trim()),
    components: template.components.map((c) => c.tag),
  };
}

/**
 * Where a mapped block starts, once the module is assembled.
 *
 * The assemblers are one template literal each. Rather than restructure them to
 * count lines as they go, each block is written under a marker that `lineMap`
 * finds, measures and removes. Nothing reaches the output.
 */
const MARK = {
  body: '/*@transclude:body*/',
  head: '/*@transclude:head*/',
  title: '/*@transclude:title*/',
};

export function compilePage(
  source,
  {
    components = new Map(),
    shadowTags = new Set(),
    runtime,
    filename = 'page',
    // What the source map names. `filename` is what an error message says, which
    // is the short route id; a stack wants the path an editor can open.
    sourcePath = null,
    layouts = [],
    client = { tags: [], hasScript: false, needed: false },
  },
) {
  const blocks = splitBlocks(source);
  const where = `${filename}.html <script server>`;
  const headWhere = `${filename}.html <script head>`;

  const server = blocks.server
    ? bindDefaultExport(blocks.server, '__load', where)
    : { code: 'const __load = null;', exports: [], imports: [], defaultNode: null };
  assertNoCollisions(server.exports, PAGE_EXPORTS, where);
  assertNoActionsObject(server.exports, where);

  const template = compileFragment(blocks.nodes, { components, shadowTags, page: true, html: blocks.html });
  assertIncludesResolve(template.regionIncludes, template.regions);

  const code = `
${runtimeImport(runtime)}
${componentImports(template.components)}
${layoutImports(layouts)}
${server.code}

export const css = ${JSON.stringify(blocks.styles.join('\n').trim())};
export const headScript = ${JSON.stringify(headScript(blocks, headWhere))};
${elementsExport(template.components)}
export const hasTitle = ${template.hasTitle};
export const layouts = [${layouts.map((_, i) => `__L${i}`).join(', ')}];
export const client = ${JSON.stringify(client)};
${regionsExport(template.regions)}
export const includes = ${JSON.stringify(template.includes ?? [])};

export async function load(ctx) {
  if (typeof __load === 'function') return (await __load(ctx)) ?? {};
  return __load ?? {};
}

export function renderTitle(__d) {
  let __o = '';
${MARK.title}
${indent(template.title)}
  return __o;
}

export function renderHtmlAttrs(__d) {
  return ${template.htmlAttrs ?? '{}'};
}

export function renderHead(__d) {
  let __o = '';
${MARK.head}
${indent(template.head)}
  return __o;
}

export function render(__d, __slots = {}, __fragment = false) {
  const __out = {};
${slotBodies(template)}
  return __out;
}
`;

  const mapped = withMap(code, template, source, sourcePath ?? `${filename}.html`);

  return {
    code: mapped.code,
    map: mapped.map,
    warnings: template.warnings,
    components: template.components.map((c) => c.tag),
  };
}

/**
 * The module, its markers removed, with a map from its lines to the file's.
 *
 * Server-side only: a page module is never sent to a browser, so embedding the
 * source costs a visitor nothing and is what lets a stack read on a host with no
 * access to the file.
 *
 * @param {string} code the assembled module, markers and all
 * @param {object} template what `compileFragment` returned
 * @param {string} source the original `.html`
 * @param {string} filename how it should be named in a stack
 * @returns {{ code: string, map: string|null }}
 */
function withMap(code, template, source, filename) {
  const blocks = [
    { marker: MARK.body, at: template.at?.body ?? [] },
    { marker: MARK.head, at: template.at?.head ?? [] },
    { marker: MARK.title, at: template.at?.title ?? [] },
  ];

  const { code: clean, lines } = lineMap(code, blocks);
  // Nothing mapped means nothing to say. An empty map is a file a tool will
  // fetch and read to learn that it knows nothing.
  if (!lines.some((line) => line !== null)) return { code: clean, map: null };

  // Handed back rather than written into the code as a comment. Vite reads a
  // map a `load` hook returns and composes it; an inline comment on the code it
  // returns is not looked at, which is why the stack still named the virtual
  // module and a generated line.
  return { code: clean, map: sourceMap(lines, filename, source) };
}

/**
 * A layout is a page that renders a hole. `render` receives the slot map its
 * child produced, and returns its own for the level above.
 *
 * @param {string} source
 * @param {{ id: string, components?: Map<string, string>,
 *   shadowTags?: Set<string>, runtime: string }} options
 * @returns {{ code: string, warnings: string[], components: string[] }}
 */
export function compileLayout(source, { id, components = new Map(), shadowTags = new Set(), runtime }) {
  const blocks = splitBlocks(source);
  const where = `${id}/_layout.html <script server>`;
  const headWhere = `${id}/_layout.html <script head>`;

  const server = blocks.server
    ? bindDefaultExport(blocks.server, '__load', where)
    : { code: 'const __load = null;', exports: [], imports: [], defaultNode: null };
  assertNoCollisions(server.exports, PAGE_EXPORTS, where);
  assertNoActionsObject(server.exports, where);

  const template = compileFragment(blocks.nodes, {
    components,
    shadowTags,
    page: true,
    layout: true,
    html: blocks.html,
  });

  const warnings = [...template.warnings];
  if (!/__slots\[/.test(template.body)) {
    warnings.push('no <slot>, so nothing rendered inside this layout would appear');
  }

  const code = `
${runtimeImport(runtime)}
${componentImports(template.components)}
${server.code}

export const css = ${JSON.stringify(blocks.styles.join('\n').trim())};
export const headScript = ${JSON.stringify(headScript(blocks, headWhere))};
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

export function renderHtmlAttrs(__d) {
  return ${template.htmlAttrs ?? '{}'};
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

export default { css, headScript, elements, hasTitle, load, renderTitle, renderHead, renderHtmlAttrs, render };
`;

  return { code, warnings, components: template.components.map((c) => c.tag) };
}

/**
 * Wraps a light element's styles in `@scope`, rooted at its own tag. A custom
 * element name is already a valid selector, so nothing has to be hashed.
 *
 * The `to` clause is the donut: styles stop at any light element nested inside,
 * so an outer one cannot reach into one it merely contains.
 *
 * @param {string} css
 * @param {string} tag the element the rules belong to
 * @param {string[]} [nested] tags rendered inside it, which the scope has to reach
 * @returns {string}
 */
export function scopeCss(css, tag, nested = []) {
  if (!css) return '';
  const limit = nested.length ? ` to (${nested.map((inner) => `${tag} ${inner}`).join(', ')})` : '';
  const indented = css.split('\n').map((line) => (line ? `  ${line}` : line)).join('\n');
  return `@scope (${tag})${limit} {\n${indented}\n}`;
}

/**
 * Component tags a template uses. This is how only those get shipped.
 *
 * @param {string} source
 * @param {Map<string, string>|Set<string>} registry every known tag
 * @returns {Set<string>} the tags this source renders
 */
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
 * top-level await. It is only checked, not rewritten.
 *
 * `elements` adds the loader for everything else: the page's own tags are
 * imported statically and defined before first paint, and any other tag in the
 * app is one dynamic import away, taken only if it ever shows up in the DOM.
 *
 * @param {Array<{ source: string, filename: string }>} sources the files whose
 *   `<script>` blocks run in the browser, layouts first and the page last
 * @param {{ tags?: string[] }} [what] the elements to define
 * @param {{ runtime: string, elements?: boolean }} options required, not
 *   defaulted: `runtime` is written into the module's import, and without it the
 *   output says `from undefined` and fails only when something tries to load it
 * @returns {{ code: string }} the code is empty when the page needs no entry
 */
export function compileClientEntry(sources, { tags = [] } = {}, { runtime, elements = false }) {
  // Layouts first, page last: the same order they wrap in.
  const blocks = sources.map(({ source, filename }) =>
    assertModule(splitBlocks(source).client, `${filename} <script>`),
  );

  // Markup can arrive after the page did, from something this framework does not
  // provide, and whatever it names has to be able to define itself.
  const imports = elements
    ? `import { watch as __watch } from ${JSON.stringify(runtime)};\n` +
      `import { elements as __elements } from ${JSON.stringify(ELEMENTS_ENTRY)};`
    : '';

  const start = elements ? '__watch(__elements);' : '';

  return {
    code: `
${imports}
${tags.map((tag, i) => `import { define as __D${i} } from ${JSON.stringify(`virtual:transclude-component/${tag}`)};`).join('\n')}

${tags.map((_, i) => `__D${i}();`).join('\n')}
${start}

${blocks.join('\n')}
`,
  };
}

/** The id of the module `compileClientEntry` reaches for when `elements` is on. */
export const ELEMENTS_ENTRY = 'virtual:transclude-elements';

/**
 * tag -> dynamic import, for every element in the app.
 *
 * A thunk rather than a URL: the bundler is the only thing that knows where the
 * chunk lands, and `import()` is how you ask it. Nothing has to be written into
 * a manifest, threaded through the server, or kept in sync with a hash.
 *
 * @param {Iterable<string>} tags every element the app defines
 * @returns {{ code: string }}
 */
export function compileElementsEntry(tags) {
  const entries = [...tags]
    .sort()
    .map(
      (tag) =>
        `  ${JSON.stringify(tag)}: () => import(${JSON.stringify(`virtual:transclude-component/${tag}`)}),`,
    );
  return { code: `export const elements = {\n${entries.join('\n')}\n};\n` };
}

/**
 * `bind` finds the node behind every expression the compiler could place, once;
 * `update` writes to them. `volatile` is the list of prop names whose change needs
 * a full repaint, because nothing here can reach them.
 *
 * An element with nothing to bind gets the same shape, empty, so the runtime
 * never has to ask whether it exists.
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
 * Props and state share one set of names in the template. `${open}` cannot say
 * which one it meant, so a name can only belong to one of them.
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
      throw new CompileError(`${label}: \`${name}\` belongs to the framework. ${advice}`, prop);
    }
  }
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A prop nobody reads is usually a rename that only got half done. A prop can
 * fairly never appear in the template. `compact` drives `:host([compact])` in CSS
 * and is toggled from the client block. So a plain word match against <style> and
 * <script> is what keeps this quiet enough to leave on.
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
        `prop \`${name}\` is declared but never used. It is not read in the template, ` +
        `and does not appear in <style> or <script>`,
    );
}

// ---- module assembly helpers ---------------------------------------------

function runtimeImport(runtime) {
  return `import { escape as __e, attr as __a, attrProp as __ap, str as __str, json, shadow as __sh, data as __data, included as __incl, textAt as __textAt, setText as __setText, setParts as __setParts, setAttr as __setAttr, setAttrProp as __setAttrProp, blockAt as __blockAt, updateBlock as __updateBlock, coerceProps, defineComponent, defineLight, html } from ${JSON.stringify(runtime)};`;
}

function layoutImports(layouts) {
  return layouts
    .map((layout, i) => `import __L${i} from ${JSON.stringify(`virtual:transclude-layout/${layout.id}`)};`)
    .join('\n');
}

/**
 * `defines` pulls each nested element's `define` in alongside its def, so a
 * component can register the elements it renders. Only a component needs that. A
 * page or layout never renders itself into a document that has not already loaded
 * its entry.
 */
function componentImports(used, { defines = false } = {}) {
  return used
    .map(({ tag, ref }) => {
      const from = JSON.stringify(`virtual:transclude-component/${tag}`);
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
/**
 * `<script head>` blocks, verbatim, in the order they were written. Attributes
 * included.
 *
 * They used to be dropped, which turned `<script head src="/theme.js">` into
 * `<script></script>`: no error, no script, nothing to see. `src` is the obvious
 * one, but `type="module"`, `nonce`, `defer` and `integrity` all mean something
 * here too.
 */
function headScript(blocks, where) {
  return blocks.head
    .map((block) => {
      const attrs = (block.attrs ?? []).filter((attr) => attr.name !== 'head');
      const external = attrs.find((attr) => attr.name === 'src');

      // The browser ignores the body of a script with a src. Emitting both would
      // silently throw away whichever the author meant.
      if (external && block.code.trim()) {
        throw new CompileError(
          `${where}: a <script head src="${external.value}"> cannot also have a body. ` +
            `the browser runs the file and ignores the code`,
        );
      }
      // This is emitted as a static string, so there is nothing to interpolate
      // into. Left alone it would ship a literal `${…}` as the URL.
      for (const attr of attrs) {
        if (!attr.value.includes('${')) continue;
        throw new CompileError(
          `${where}: \`${attr.name}\` on a <script head> cannot interpolate. ` +
            `the block is emitted into <head> before any data exists`,
        );
      }

      return `<script${attrs.map(serializeAttr).join('')}>${block.code}</script>`;
    })
    .join('\n');
}

/** A static attribute, escaped the way an HTML serializer must. */
function serializeAttr({ name, value }) {
  if (value === '') return ` ${name}`;
  const escaped = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  return ` ${name}="${escaped}"`;
}

function elementsExport(used) {
  return `export const elements = [${used.map(({ ref }) => ref).join(', ')}];`;
}

/**
 * Each `[fragment]` region as a function of the page's own data. The same markup
 * the document got, so a swap cannot drift from the page it replaces part of.
 */
/**
 * Every `<transclude src="#id">` names a region this page has, and no
 * region includes itself.
 *
 * Both are compile-time answers. A missing region would be a call to undefined
 * on a page that looked fine, and a cycle would be a stack overflow while
 * answering a request.
 */
function assertIncludesResolve(includes, regions) {
  const names = new Set(Object.keys(regions ?? {}));

  for (const { id, node } of includes ?? []) {
    if (names.has(id)) continue;
    throw new CompileError(
      `<transclude src="#${id}"> names no region of this page. ` +
        `A region is an element with an id and a "fragment" attribute.`,
      node,
    );
  }

  // An edge from the region an include sits in to the region it pulls. An
  // include outside every region cannot be part of a cycle: nothing includes
  // the page body.
  const edges = new Map();
  for (const { id, within } of includes ?? []) {
    if (!within) continue;
    if (!edges.has(within)) edges.set(within, new Set());
    edges.get(within).add(id);
  }

  const seen = new Set();
  const walk = (name, chain) => {
    if (chain.includes(name)) {
      throw new CompileError(
        `<transclude> includes itself: ${[...chain, name].map((n) => `#${n}`).join(' includes ')}. ` +
          `Rendering it would not finish.`,
        (includes ?? []).find(({ id }) => id === name)?.node ?? null,
      );
    }
    if (seen.has(name)) return;
    seen.add(name);
    for (const next of edges.get(name) ?? []) walk(next, [...chain, name]);
  };

  for (const name of edges.keys()) walk(name, []);
}

function regionsExport(regions) {
  const entries = Object.entries(regions ?? {});
  if (!entries.length) return 'export const regions = {};';

  const bodies = entries.map(
    ([name, body]) =>
      `  ${JSON.stringify(name)}: (__d, __slots = {}, __fragment = true, __named = true) => {\n` +
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
  // handed on rather than dropped. Without that, a page could only fill a slot in
  // its nearest layout.
  const consumed = JSON.stringify([...(template.consumed ?? []), 'default']);
  const parts = [
    // A region's markup is emitted once and used twice, in the page and in the
    // region's own function, so the id it carries is written conditionally. The
    // copy that renders inline is the one that keeps the name.
    `  const __named = true;`,
    `  const __pass = new Set(${consumed});`,
    `  for (const __name in __slots) if (!__pass.has(__name)) __out[__name] = __slots[__name];`,
    `  {\n    let __o = '';\n${MARK.body}\n${indent(indent(template.body))}\n    __out.default = __o;\n  }`,
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
