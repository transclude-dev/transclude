// Turns a .html file into JavaScript that means the same thing, so tsc can
// check it.
//
// JavaScript rather than TypeScript, deliberately: a JSDoc `@type` in the
// author's own `<script props>` is honoured in a .js file and silently ignored
// in a .ts one. Since the whole point is to check what the author wrote, the
// shim speaks the same language they do — the scaffolding uses JSDoc too.
//
// The shim is never written to disk and never executed — it exists only to be
// type checked. Its one hard requirement is that every position tsc reports can
// be traced back to the .html file, so it is assembled from chunks: text we
// generated (unmapped) and text copied verbatim from the source (mapped). A
// diagnostic offset lands inside one chunk, and a verbatim chunk knows where it
// came from.

import { parse, parseExpressionAt } from 'acorn';
import { childrenOf } from './codegen.js';
import { splitInterpolations } from './interp.js';
import { splitBlocks } from './index.js';
import { planLift } from './script.js';

const DIRECTIVES = new Set(['if', 'else-if', 'else', 'each']);

class Builder {
  constructor() {
    this.chunks = [];
    this.length = 0;
    // A block that will not parse cannot be turned into anything tsc can read.
    // Rather than emit a degraded shim and let tsc invent consequences in other
    // files, the failure is carried out and reported where it happened.
    this.syntaxErrors = [];
  }

  /** An acorn failure, relocated from inside the block to the .html file. */
  failed(error, block) {
    this.syntaxErrors.push({
      offset: block.offset + (error.pos ?? 0),
      message: error.message.replace(/\s*\(\d+:\d+\)$/, ''),
    });
  }

  /** Text we invented. Diagnostics landing here have nowhere useful to point. */
  add(text) {
    if (!text) return;
    this.chunks.push({ start: this.length, text, source: null });
    this.length += text.length;
  }

  /** Text lifted from the .html file, carrying the offset it came from. */
  copy(text, sourceOffset) {
    if (!text) return;
    this.chunks.push({ start: this.length, text, source: sourceOffset });
    this.length += text.length;
  }

  build() {
    return {
      code: this.chunks.map((chunk) => chunk.text).join(''),
      chunks: this.chunks,
      syntaxErrors: this.syntaxErrors,
    };
  }
}

/**
 * Maps an offset in the shim back to an offset in the .html file, or null when
 * it landed in generated scaffolding.
 */
export function originalOffset(chunks, offset) {
  let low = 0;
  let high = chunks.length - 1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const chunk = chunks[mid];
    if (offset < chunk.start) high = mid - 1;
    else if (offset >= chunk.start + chunk.text.length) low = mid + 1;
    else return chunk.source === null ? null : chunk.source + (offset - chunk.start);
  }
  return null;
}

/**
 * `page`, `layout` and `component` differ only in where their data comes from:
 * a loader checked against a route context, or a props object.
 */
export function buildShim(source, { kind, shadow = false, contextType = null, componentProps = new Map() }) {
  const blocks = splitBlocks(source);
  const out = new Builder();

  // Without at least one import or export a file is a *global script*, and every
  // shim's __Data would collide in one shared scope. This keeps each file's
  // types its own.
  out.add('export {};\n');

  // Two jobs, both about letting the author write plain JS.
  //
  // The mapping is what keeps `${user.nmae}` an error. TypeScript treats a type
  // that came straight from an object literal in a .js file as open for expando
  // properties, so reading an undeclared one is allowed — remapping the keys
  // produces an ordinary object type, which is not.
  //
  // The conditional widens a bare `[]`, which otherwise infers `never[]` and
  // turns "no annotation" from "less checking" into a page of errors about a
  // type nobody wrote.
  out.add(
    '/**\n * @template T\n' +
      ' * @typedef {{ [K in keyof T]: T[K] extends never[] ? any[] : T[K] }} __Shape\n */\n',
  );

  const used = [...collectUsedTags(blocks.nodes, componentProps)];

  if (kind === 'component') {
    // Props and state share one namespace in the template, so they are one type
    // by the time anything reads them.
    emitModule(blocks.properties, out, null, '__Props', '__props');
    emitModule(blocks.state, out, null, '__State', '__stateDefaults');
    out.add('/** @typedef {__Props & __State} __Data */\n\n');
    // Each converter is tied to the prop it converts: `from` has to produce
    // that prop's type, and `to` is handed it. Written out so the author does
    // not have to annotate a parameter whose type is already known.
    out.add(
      '/**\n * @typedef {{ [K in keyof __Props]?: {\n' +
        ' *   from?: (text: string) => __Props[K];\n' +
        ' *   to?: (value: __Props[K]) => string | number | boolean | null | undefined;\n' +
        ' * } }} __Attrs\n */\n\n',
    );
  } else {
    emitModule(blocks.server, out, contextType, '__Data', '__default');
  }
  emitMembers(kind === 'component' ? blocks.client : [], out, shadow);

  // Helpers arrive as parameters rather than module-scope declarations: a
  // parameter shadows, so it cannot collide with something the author imported.
  out.add('/**\n');
  out.add(' * @param {__Data} __d\n');
  out.add(' * @param {(value: unknown) => string} html\n');
  out.add(' * @param {(value: unknown) => void} __expr\n');
  for (const tag of used) {
    out.add(` * @param {(value: Partial<${componentProps.get(tag)}>) => void} ${propsFn(tag)}\n`);
  }
  out.add(' */\n');
  out.add(`function __template(__d, html, __expr${used.map((tag) => `, ${propsFn(tag)}`).join('')}) {\n`);
  emitNodes(blocks.nodes, out, new Set(), componentProps, 1);
  out.add('}\n');

  // Client blocks are not otherwise part of the shim — they run in the browser
  // with `host`, `shadow` and `signal` in scope, which tsc has no way to know.
  // They are still parsed, because a syntax error there should be reported by
  // the same command that reports every other one.
  for (const block of blocks.client) {
    try {
      parse(block.code, {
        ecmaVersion: 'latest',
        sourceType: 'module',
        allowAwaitOutsideFunction: true,
        allowReturnOutsideFunction: true,
      });
    } catch (error) {
      out.failed(error, block);
    }
  }

  // The one export the type extractor reads: whatever __Data resolved to is the
  // file's data shape, and asking tsc for it is how hf-env.d.ts gets written.
  out.add('\n/** @type {__Data} */\n');
  out.add('export let __data;\n');
  out.add('/** @type {__Members} */\n');
  out.add('export let __members;\n');
  if (kind === 'component') {
    // Read separately from __data: a parent passes props and cannot reach
    // state, so the type a parent is checked against must not include it.
    out.add('/** @type {__Props} */\n');
    out.add('export let __propTypes;\n');
    out.add('/** @type {__State} */\n');
    out.add('export let __state;\n');
  }

  return out.build();
}

/**
 * `<script server>` and `<script props>` are module bodies, not expressions: they
 * have imports and may have named exports of their own. Those stay where they
 * are — the shim is a module too — and only the default export is rebound. For a
 * loader that rebinding is what types its parameter from the route context while
 * leaving the return type inferred.
 */
function emitModule(block, out, contextType, name = '__Data', binding = '__default') {
  if (!block) {
    out.add(`/** @typedef {{}} ${name} */\n\n`);
    return;
  }
  let ast;
  try {
    ast = parse(block.code, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true });
  } catch (error) {
    // Half a file gives tsc nothing useful to say, so the parse failure itself
    // is the diagnostic.
    out.failed(error, block);
    out.add(`/** @typedef {{}} ${name} */\n\n`);
    return;
  }

  // The block is copied whole with pieces spliced in at exact offsets, so every
  // position still maps back to the .html file. Copying statement by statement
  // would drop everything that is not a statement — a floating `@typedef`, or a
  // JSDoc comment attached to an export — and those are exactly how an author
  // says what an empty array holds.
  const edits = [];

  // A props block annotates `attributes`; a server block annotates `actions`,
  // which types every handler's own `ctx` from the same route context the
  // loader gets. Neither depends on there being a default export.
  const attrs = binding === '__props' ? namedExport(ast, 'attributes') : null;
  if (attrs) edits.push({ at: attrs.start, insert: '/** @type {__Attrs} */\n' });

  const actions = contextType ? namedExport(ast, 'actions') : null;
  if (actions) {
    // The same route context, except that `request` is not nullable here. It is
    // null only while prerendering, and prerendering never runs an action — so
    // the intersection narrows `Request | null` to `Request` and an author does
    // not have to answer a question that cannot come up.
    edits.push({
      at: actions.start,
      insert:
        `/** @satisfies {Record<string, ` +
        `(ctx: ${contextType} & { request: Request }) => unknown>} */\n`,
    });
  }

  const statement = ast.body.find((node) => node.type === 'ExportDefaultDeclaration');
  const declaration = statement?.declaration;
  if (statement) edits.push({ at: statement.start, statement });
  edits.sort((a, b) => a.at - b.at);

  let cursor = 0;
  for (const edit of edits) {
    out.copy(block.code.slice(cursor, edit.at), block.offset + cursor);
    cursor = edit.at;

    if (edit.insert) {
      out.add(edit.insert);
      continue;
    }
    // `satisfies` is doing real work: it contextually types the loader's own
    // parameter *and* leaves the return type intact for the template below. An
    // annotation would flatten one or the other.
    //
    // The loader's `ctx.action` is whatever this page's own actions return —
    // `unknown` in the route context, narrowed here by intersection to the
    // union of their return types. A `Response` is excluded because returning
    // one short-circuits: the loader never runs, so it can never see it.
    if (contextType) {
      const action = actions
        ? `Exclude<Awaited<ReturnType<(typeof actions)[keyof typeof actions]>>, Response>`
        : 'null';
      out.add(
        `\n/** @satisfies {(ctx: ${contextType} & { action: ${action} | null }) => unknown} */\n`,
      );
    }
    out.add(`const ${binding} = (`);
    out.copy(
      block.code.slice(declaration.start, declaration.end),
      block.offset + declaration.start,
    );
    out.add(');\n');
    cursor = statement.end;
  }
  out.copy(block.code.slice(cursor), block.offset + cursor);
  out.add('\n');

  // No default export is a block that only does other things — `paths`,
  // `prerender`, `actions`. It renders from nothing, so its data shape is empty.
  if (!statement) {
    out.add(`/** @typedef {{}} ${name} */\n\n`);
    return;
  }

  out.add(
    contextType
      ? `/** @typedef {__Shape<Awaited<ReturnType<typeof ${binding}>>>} ${name} */\n\n`
      : `/** @typedef {__Shape<typeof ${binding}>} ${name} */\n\n`,
  );
}

/**
 * `export const prototype` is checked the same way as everything else, with one
 * addition: `this` inside its members has to mean the element.
 *
 * `T & ThisType<Host & __Data & T>` is the whole trick. `T` infers from the
 * object literal, so the members keep their real types and hf-env.d.ts can be
 * written from them; `ThisType` contextually types `this` without changing what
 * the value is. Including `T` in the intersection is what lets one member call
 * another.
 *
 * `shadowRoot` is narrowed rather than left as `ShadowRoot | null`: a component
 * always has one by the time any of this runs, and a partial never does. The
 * DOM's type cannot know that, but the directory the file is in does.
 *
 * Only the members and what they read come across. The rest of the block runs
 * with `host`, `shadow` and `signal` in scope, which tsc has no way to know —
 * and its imports may be browser-only, so they are copied only where a member
 * actually uses them. Blocks that will not parse are skipped in silence here;
 * the syntax pass below is what reports them, once.
 */
function emitMembers(blocks, out, shadow) {
  for (const block of blocks) {
    let ast;
    try {
      ast = parse(block.code, {
        ecmaVersion: 'latest',
        sourceType: 'module',
        allowAwaitOutsideFunction: true,
        allowReturnOutsideFunction: true,
      });
    } catch {
      continue;
    }

    const plan = planLift(ast, 'prototype');
    if (!plan) continue;

    for (const statement of ast.body) {
      if (statement.type !== 'ImportDeclaration') continue;
      if (!statement.specifiers.some((spec) => plan.reads.has(spec.local.name))) continue;
      out.copy(block.code.slice(statement.start, statement.end), block.offset + statement.start);
      out.add('\n');
    }
    for (const dependency of plan.deps) {
      out.copy(block.code.slice(dependency.start, dependency.end), block.offset + dependency.start);
      out.add('\n');
    }

    const host = `HTMLElement & { shadowRoot: ${shadow ? 'ShadowRoot' : 'null'} }`;
    out.add(
      '\n/**\n * @template T\n' +
        ` * @param {T & ThisType<${host} & __Data & T>} m\n` +
        ' * @returns {T}\n */\n' +
        'function __self(m) { return m; }\n' +
        'const __memberDefs = __self(',
    );
    out.copy(block.code.slice(plan.init.start, plan.init.end), block.offset + plan.init.start);
    out.add(');\n/** @typedef {typeof __memberDefs} __Members */\n\n');
    return;
  }
  out.add('/** @typedef {{}} __Members */\n\n');
}

/** `export const <name> = …`, as a statement, or null. */
function namedExport(ast, name) {
  return (
    ast.body.find(
      (node) =>
        node.type === 'ExportNamedDeclaration' &&
        node.declaration?.type === 'VariableDeclaration' &&
        node.declaration.declarations.some(
          (declarator) => declarator.id.type === 'Identifier' && declarator.id.name === name,
        ),
    ) ?? null
  );
}

/** A distinct checker per component tag, since JS cannot pass a type argument. */
function propsFn(tag) {
  return `__props_${tag.replace(/[^A-Za-z0-9]/g, '_')}`;
}

function emitNodes(nodes, out, scope, components, depth) {
  for (const node of nodes) {
    if (node.nodeName === '#text') {
      emitInterpolations(node.value ?? '', node.sourceCodeLocation?.startOffset ?? 0, out, scope, depth);
      continue;
    }
    if (!node.tagName) continue;

    const each = node.attrs?.find((attr) => attr.name === 'each');
    const inner = new Set(scope);
    let closes = 0;

    if (each) {
      const spec = /^\s*([A-Za-z_$][\w$]*)\s*(?:,\s*([A-Za-z_$][\w$]*)\s*)?\s+of\s+([\s\S]+?)\s*$/.exec(
        each.value,
      );
      if (spec) {
        const listOffset = attrValueOffset(node, 'each') + each.value.indexOf(spec[3]);
        indent(out, depth);
        out.add(`for (const ${spec[1]} of `);
        emitExpression(spec[3], listOffset, out, scope);
        out.add(') {\n');
        inner.add(spec[1]);
        if (spec[2]) {
          indent(out, depth + 1);
          out.add(`const ${spec[2]}: number = 0;\n`);
          inner.add(spec[2]);
        }
        closes++;
      }
    }

    const body = depth + closes;

    // A component's interpolated attributes are checked as props below; emitting
    // them here as well would report every mistake twice.
    const isComponent = components.has(node.tagName);

    for (const attr of node.attrs ?? []) {
      if (attr.name === 'each') continue;
      const offset = attrValueOffset(node, attr.name);

      if (DIRECTIVES.has(attr.name)) {
        if (attr.name === 'else') continue;
        indent(out, body);
        out.add('__expr(');
        emitExpression(attr.value, offset, out, inner);
        out.add(');\n');
        continue;
      }
      if (isComponent && /\$\{/.test(attr.value)) continue;
      emitInterpolations(attr.value, offset, out, inner, body);
    }

    if (isComponent) emitComponentProps(node, out, inner, components, body);

    emitNodes(childrenOf(node), out, inner, components, body);

    for (let i = 0; i < closes; i++) {
      indent(out, depth + closes - 1 - i);
      out.add('}\n');
    }
  }
}

/** Only interpolated props are checked; a literal attribute is coerced at runtime. */
function emitComponentProps(node, out, scope, components, depth) {
  const dynamic = (node.attrs ?? []).filter(
    (attr) => !DIRECTIVES.has(attr.name) && /\$\{/.test(attr.value),
  );
  if (!dynamic.length) return;

  indent(out, depth);
  out.add(`${propsFn(node.tagName)}({ `);
  for (const attr of dynamic) {
    const parts = splitInterpolations(attr.value);

    // Props are declared camelCase and written dash-case, so the key is checked
    // under the name `<script props>` gave it. Still mapped to the attribute in
    // the source: an unmapped key would have its diagnostic dropped.
    const prop = camelCase(attr.name);
    if (/^[A-Za-z_$][\w$]*$/.test(prop)) {
      out.copy(prop, attrNameOffset(node, attr.name));
      out.add(': ');
    } else {
      out.add(`${JSON.stringify(attr.name)}: `);
    }
    if (parts.length === 1 && parts[0].type === 'expr') {
      emitExpression(parts[0].value, attrValueOffset(node, attr.name) + 2, out, scope);
    } else {
      out.add('""');
    }
    out.add(', ');
  }
  out.add('});\n');
}

function emitInterpolations(text, offset, out, scope, depth) {
  let cursor = 0;
  for (const part of splitInterpolations(text)) {
    if (part.type === 'expr') {
      // `${` is two characters before the expression itself.
      const start = offset + text.indexOf(part.value, cursor);
      indent(out, depth);
      out.add('__expr(');
      emitExpression(part.value, start, out, scope);
      out.add(');\n');
    }
    cursor += part.value.length;
  }
}

/**
 * Copies an expression verbatim, prefixing the identifiers that come from
 * template data with `__d.`. Prefixing only inserts, so everything the author
 * wrote keeps its own offset and a diagnostic points at the real token.
 */
function emitExpression(text, offset, out, scope) {
  let ast;
  try {
    ast = parseExpressionAt(text, 0, { ecmaVersion: 'latest' });
  } catch {
    out.add('undefined');
    return;
  }

  const roots = [];
  collectRoots(ast, scope, roots);
  roots.sort((a, b) => a.start - b.start);

  let cursor = 0;
  for (const root of roots) {
    out.copy(text.slice(cursor, root.start), offset + cursor);
    out.add('__d.');
    cursor = root.start;
  }
  out.copy(text.slice(cursor), offset + cursor);
}

/** Identifiers that are neither loop variables nor globals resolve to data. */
function collectRoots(node, scope, out) {
  if (!node || typeof node !== 'object' || !node.type) return;

  switch (node.type) {
    case 'Identifier':
      if (!scope.has(node.name) && !GLOBALS.has(node.name)) out.push(node);
      return;
    case 'MemberExpression':
      collectRoots(node.object, scope, out);
      if (node.computed) collectRoots(node.property, scope, out);
      return;
    case 'CallExpression':
      collectRoots(node.callee, scope, out);
      for (const arg of node.arguments) collectRoots(arg, scope, out);
      return;
    default:
      for (const key of ['argument', 'left', 'right', 'test', 'consequent', 'alternate', 'expression']) {
        if (node[key]) collectRoots(node[key], scope, out);
      }
      for (const element of node.elements ?? []) collectRoots(element, scope, out);
      return;
  }
}

const GLOBALS = new Set([
  'html', 'Math', 'JSON', 'String', 'Number', 'Boolean', 'Array', 'Object', 'Date',
  'isNaN', 'parseInt', 'parseFloat', 'undefined', 'NaN', 'Infinity', 'true', 'false', 'null',
]);

function collectUsedTags(nodes, components, found = new Set()) {
  for (const node of nodes) {
    if (!node.tagName) continue;
    if (components.has(node.tagName)) found.add(node.tagName);
    collectUsedTags(childrenOf(node), components, found);
  }
  return found;
}

/** `page-size` -> `pageSize`, matching the runtime's attrName in reverse. */
function camelCase(attr) {
  return attr.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function attrNameOffset(node, name) {
  return node.sourceCodeLocation?.attrs?.[name]?.startOffset ?? node.sourceCodeLocation?.startOffset ?? 0;
}

function attrValueOffset(node, name) {
  const location = node.sourceCodeLocation?.attrs?.[name];
  if (!location) return node.sourceCodeLocation?.startOffset ?? 0;
  // startOffset points at the attribute name; step past `name="`.
  return location.startOffset + name.length + 2;
}

function indent(out, depth) {
  out.add('  '.repeat(Math.max(1, depth)));
}
