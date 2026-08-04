// Walks a parse5 tree and emits the body of a render function.
//
// Rules this file encodes:
//   - every ${} is escaped; html() opts out
//   - `if` / `else-if` / `else` bind across whitespace + comments only
//   - `if` and `each` on the same element is a hard error
//   - a <template> carrying a directive is consumed; one without any is emitted verbatim
//   - false/null/undefined attribute values drop the attribute entirely

import { Scope, collectRefs, emit, parseExpr } from './expr.js';
import { splitInterpolations } from './interp.js';

const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

// Content is not entity-decoded by the parser and must not be escaped by us.
const RAW_TEXT = new Set(['script', 'style']);

// Hoisted out of a page body into <head>.
const HEAD_TAGS = new Set(['title', 'meta', 'link', 'base']);

const DIRECTIVES = new Set(['if', 'else-if', 'else', 'each', 'key', 'fragment']);

/**
 * The inclusion element. Reserved: an app cannot define one in `elements/`,
 * because this is read before the component table is consulted.
 */
export const INCLUDE_TAG = 'transclude';
const BRANCH = ['if', 'else-if', 'else'];

export class CompileError extends Error {
  constructor(message, node) {
    const line = node?.sourceCodeLocation?.startLine;
    super(line ? `${message} (line ${line})` : message);
    this.name = 'CompileError';
    this.line = line;
  }
}

/**
 * An attribute name is emitted exactly as written, so `${…}` in one reaches the
 * page as those characters rather than as a value. Nothing downstream reads it,
 * which made this the one interpolation mistake that rendered instead of
 * failing. A spread parses as an attribute name too, and is caught here.
 *
 * @param {object} el
 * @throws {CompileError} when a name holds an interpolation
 */
function assertStaticAttrNames(el) {
  for (const attr of el.attrs ?? []) {
    if (!attr.name.includes('${')) continue;

    throw new CompileError(
      `<${el.tagName}> interpolates an attribute name: "${attr.name}". ` +
        `Only a value takes \${…}, so write the name out. To choose between two, ` +
        `put the condition in the value: class="\${cond ? 'a' : 'b'}".`,
      el,
    );
  }
}

/**
 * @param {object[]} nodes
 * @param {object} [opts]
 * @returns {object} the render body, the regions, the slots, the includes and the warnings
 */
export function compileFragment(nodes, opts = {}) {
  const gen = new Codegen(opts);
  gen.emitChildren(nodes, gen.body, gen.rootScope, true);

  // `<html>` is read separately, because the fragment parser drops it: a nested
  // html start tag is not something that can appear in a body, so parse5 throws
  // it away attributes and all. `splitBlocks` reads it in document mode, where
  // it is the element it names.
  const htmlNode = opts.html ?? null;
  const htmlAttrs = htmlNode?.attrs?.length ? gen.htmlAttrsJs(htmlNode, gen.rootScope) : null;

  const body = joinOut(gen.body);
  const head = joinOut(gen.head);
  const title = joinOut(gen.title);
  const slots = [...gen.slots].map(([name, out]) => [name, joinOut(out)]);
  const regions = [...gen.regions].map(([name, out]) => [name, joinOut(out)]);

  // Every block's code, and beside it which source line each of its lines came
  // from. The assemblers put the code into a module and record where each block
  // landed; `lineMap` turns the two into a source map.
  const at = {
    body: body.at,
    head: head.at,
    title: title.at,
    slots: Object.fromEntries(slots.map(([name, out]) => [name, out.at])),
    regions: Object.fromEntries(regions.map(([name, out]) => [name, out.at])),
  };

  return {
    body: body.code,
    at,
    blockDefs: gen.blockDefs.join('\n'),
    blockOf: gen.blockOf,
    slots: Object.fromEntries(slots.map(([name, out]) => [name, out.code])),
    regions: Object.fromEntries(regions.map(([name, out]) => [name, out.code])),
    regionIncludes: gen.regionIncludes,
    includes: gen.includes.map(({ key, kind, where, id }) => ({ key, kind, where, id })),
    consumed: [...gen.consumed],
    head: head.code,
    title: title.code,
    hasTitle: gen.title.length > 0,
    htmlAttrs,
    warnings: gen.warnings,
    reads: gen.reads,
    components: [...gen.used.entries()].map(([tag, ref]) => ({ tag, ref })),
  };
}

class Codegen {
  constructor({
    components = new Map(),
    shadowTags = new Set(),
    page = false,
    layout = false,
    blocks = false,
    fragments = true,
  } = {}) {
    // Whether this template can be asked for a fragment. A page or a light
    // element can; a shadow one cannot, because a fragment emits the element bare
    // and never calls its render at all. That matters beyond tidiness: with
    // `blocks` on, an `if` or `each` compiles to its own module-scope function,
    // and a `__fragment` passed from render would not be in scope inside it.
    this.fragments = fragments;
    // With `blocks` on, `if` and `each` at the top level compile to their own
    // function and are wrapped in comment anchors, so an update can re-render
    // one region instead of the whole shadow root. Only an element is ever
    // updated, so nothing else pays for the anchors.
    this.blocks = blocks && !layout;
    this.blockDefs = [];
    this.blockOf = new Map();
    this.inBlock = 0;
    // The loop variables in scope, outermost first, two per level. A block
    // inside a loop renders from them, so its function has to take them.
    this.loops = [];
    this.components = components;
    // Which of them render into a shadow root. Everything else renders inline.
    // That depends on the child's own declaration, not its parent's.
    this.shadowTags = shadowTags;
    this.page = page;
    this.layout = layout;
    this.seen = new Set();
    this.reads = new Set();
    this.rootScope = new Scope();
    this.body = [];
    this.head = [];
    this.title = [];
    // `<template slot="x">` at the top level of a page or layout fills the named
    // slot of the level above it, so it compiles to its own buffer.
    this.slots = new Map();
    // Slot names this level actually renders. Anything else it was handed
    // belongs to a level further out and has to travel on.
    this.consumed = new Set();
    // `<ul id="results" fragment>` is a region of the page that can be asked for
    // on its own. It renders inline like anything else *and* compiles to its own
    // function, so the same markup serves the document and the swap.
    this.regions = new Map();
    // Every `<transclude src="#id">`, with the region it sits inside, so a cycle
    // is found at compile time rather than as a stack overflow during a render.
    // Kept apart from the ones below because these need no server to resolve.
    this.regionIncludes = [];
    // The ones a server has to resolve before the render: another route of this
    // app, or a document elsewhere.
    this.includes = [];
    this.inRegion = [];
    this.regionRoot = null;
    this.warnings = [];
    this.used = new Map();
    this.uid = 0;
  }

  // ---- helpers ------------------------------------------------------------

  s(out, text) {
    if (text) out.push({ t: 's', v: text, at: this.at });
  }

  c(out, code) {
    out.push({ t: 'c', v: code, at: this.at });
  }

  /**
   * The source line everything emitted from here belongs to.
   *
   * Carried on the chunk rather than worked out later, because by the time the
   * lines are joined the node that produced them is gone. `null` when parse5 gave
   * no location, which is what a synthesised node has: the map simply says
   * nothing about those lines rather than guessing.
   */
  at = null;

  /** Runs `fn` with the position set to `node`'s, and puts it back after. */
  from(node, fn) {
    const was = this.at;
    this.at = node?.sourceCodeLocation?.startLine ?? was;
    try {
      return fn();
    } finally {
      this.at = was;
    }
  }

  warn(message, node) {
    const line = node?.sourceCodeLocation?.startLine;
    this.warnings.push(line ? `${message} (line ${line})` : message);
  }

  expr(source, scope, node) {
    const ast = this.parse(source, node);
    this.note(collectRefs(ast, scope));
    try {
      return emit(ast, scope);
    } catch (err) {
      throw new CompileError(`bad expression ${JSON.stringify(String(source).trim())}: ${err.message}`, node);
    }
  }

  parse(source, node) {
    try {
      return parseExpr(source);
    } catch (err) {
      throw new CompileError(`bad expression ${JSON.stringify(String(source).trim())}: ${err.message}`, node);
    }
  }

  /** Records which data keys the template reads, for the unused-prop check. */
  note(refs) {
    for (const ref of refs) {
      if (ref.base === 'data') this.reads.add(ref.name);
    }
  }

  report(message, node) {
    const line = node?.sourceCodeLocation?.startLine;
    const text = line ? `${message} (line ${line})` : message;
    if (this.seen.has(text)) return;
    this.seen.add(text);
    this.warnings.push(text);
  }

  componentRef(tag) {
    if (!this.used.has(tag)) this.used.set(tag, `__C${this.used.size}`);
    return this.used.get(tag);
  }

  // ---- traversal ----------------------------------------------------------

  emitChildren(nodes, out, scope, topLevel = false) {
    let i = 0;
    while (i < nodes.length) {
      const node = nodes[i];

      // A top-level `<template slot="x">` is not content of this level; it is
      // content *for the level above*, so it is compiled somewhere else.
      if (topLevel && node.tagName === 'template') {
        const slot = node.attrs?.find((a) => a.name === 'slot')?.value;
        if (slot) {
          const target = this.slots.get(slot) ?? [];
          this.slots.set(slot, target);
          this.emitChildren(childrenOf(node), target, scope, false);
          i++;
          continue;
        }
      }

      const dirs = directivesOf(node);

      if (dirs?.has('if')) {
        const { chain, next } = gatherChain(nodes, i);
        this.emitIfChain(chain, out, scope, topLevel);
        i = next;
        continue;
      }

      if (dirs?.has('else-if') || dirs?.has('else')) {
        const name = dirs.has('else') ? 'else' : 'else-if';
        throw new CompileError(
          `"${name}" on <${node.tagName}> has no "if" before it`,
          node,
        );
      }

      this.emitNode(node, out, scope, topLevel);
      i++;
    }
  }

  /**
   * True where a structural block is addressable on its own. Anchors nest and
   * the runtime counts depth, and a block inside a loop takes that loop's
   * variables as arguments, so nesting is not a reason to give up on either.
   */
  standalone() {
    return this.blocks;
  }

  /** Flat list of the loop variables in scope, outermost first. */
  loopArgs() {
    return this.loops.flatMap((loop) => [loop.item, loop.index]);
  }

  /**
   * The block's markup lives in exactly one place: this function. `render` calls
   * it, and so does an update. Anything nested inside is emitted inline, because
   * re-rendering the outer block covers it.
   */
  emitBlock(node, out, body, extra = '', args = []) {
    const id = this.blockDefs.length;
    const params = ['__d', ...args].join(', ');
    this.blockOf.set(node, id);
    this.blockDefs.push(
      `const __blk${id} = { ${extra}html: (${params}) => { let __o = '';\n${joinOut(body).code}\nreturn __o; } };`,
    );
    this.s(out, ANCHOR_OPEN);
    this.c(out, `__o += __blk${id}.html(${params});`);
    this.s(out, ANCHOR_CLOSE);
  }

  emitIfChain(chain, out, scope, topLevel) {
    if (this.standalone()) {
      const args = this.loopArgs();
      const body = [];
      this.inBlock++;
      this.emitBranches(chain, body, scope, topLevel);
      this.inBlock--;
      this.emitBlock(chain[0].node, out, body, '', args);
      return;
    }
    this.emitBranches(chain, out, scope, topLevel);
  }

  emitBranches(chain, out, scope, topLevel) {
    for (const branch of chain) {
      if (branch.kind === 'if') {
        this.c(out, `if (${this.expr(branch.cond, scope, branch.node)}) {`);
      } else if (branch.kind === 'else-if') {
        this.c(out, `} else if (${this.expr(branch.cond, scope, branch.node)}) {`);
      } else {
        this.c(out, `} else {`);
      }
      // Inside a branch the element may still carry `each`; emitNode handles it,
      // but the if+each combination is rejected up front.
      this.emitNode(branch.node, out, scope, topLevel);
    }
    this.c(out, `}`);
  }

  emitNode(node, out, scope, topLevel) {
    return this.from(node, () => this.emitNodeAt(node, out, scope, topLevel));
  }

  emitNodeAt(node, out, scope, topLevel) {
    if (node.nodeName === '#text') {
      this.emitText(node.value ?? '', out, scope, node, false);
      return;
    }
    // Authoring comments are stripped. They still count as "insignificant" when
    // linking an else to its if, so they can sit between branches.
    if (node.nodeName === '#comment') return;
    if (!node.tagName) return;

    const dirs = directivesOf(node);
    if (dirs.has('each') && BRANCH.some((b) => dirs.has(b))) {
      throw new CompileError(
        `<${node.tagName}> carries both "each" and "${BRANCH.find((b) => dirs.has(b))}". ` +
          `Which runs first would be unclear. Wrap one in a <template>.`,
        node,
      );
    }

    const region = this.regionOf(node, dirs);
    if (region) {
      // Emitted once, used twice: the items go into the region's own buffer and
      // then straight into the page. Rendering it separately would be a second
      // copy of the markup that could drift from the first.
      const buffer = [];
      this.inRegion.push(region);
      this.regionRoot = node;
      this.emitElement(node, buffer, scope, topLevel);
      this.regionRoot = null;
      this.inRegion.pop();
      this.regions.set(region, buffer);
      for (const item of buffer) out.push(item);
      return;
    }

    if (dirs.has('each')) this.emitEach(node, out, scope, topLevel);
    else this.emitElement(node, out, scope, topLevel);
  }

  /**
   * The name of the addressable region this element is, or null.
   *
   * The name is the element's `id`, on purpose, rather than a second name that
   * could disagree with it. The URL that asks for the region and the selector that
   * swaps it in are the same word, so `?fragment=results` targets `#results` and
   * there is nothing to keep in sync.
   */
  regionOf(node, dirs) {
    const attr = node.attrs?.find((a) => a.name === 'fragment');
    if (!attr) return null;

    if (!this.page || this.layout) {
      throw new CompileError(
        `<${node.tagName}> carries "fragment", which addresses a region of a page over ` +
          `HTTP. A component re-renders itself and has no URL to be asked for.`,
        node,
      );
    }
    const clash = ['if', 'else-if', 'else', 'each'].find((name) => dirs.has(name));
    if (clash) {
      throw new CompileError(
        `<${node.tagName}> carries both "fragment" and "${clash}". A region is one ` +
          `element with one id, so it cannot be conditional or repeated. Put the ` +
          `"${clash}" on something inside it.`,
        node,
      );
    }
    if (this.loops.length || this.inBlock) {
      throw new CompileError(
        `<${node.tagName}> carries "fragment" inside a loop, so it has no id of its own ` +
          `and its markup depends on a loop variable the region could not be given.`,
        node,
      );
    }

    const id = node.attrs.find((a) => a.name === 'id')?.value;
    if (!id) {
      throw new CompileError(
        `<${node.tagName}> carries "fragment" but has no id. The id is the region's ` +
          `name. It is what the URL asks for and what a swap targets.`,
        node,
      );
    }
    if (/\$\{/.test(id)) {
      throw new CompileError(
        `<${node.tagName}> has an interpolated id, so its name is not knowable at ` +
          `compile time and no URL could ask for it.`,
        node,
      );
    }
    if (attr.value !== '') {
      throw new CompileError(
        `"fragment" takes no value. The region is named by its id, which is ` +
          `"${id}" here.`,
        node,
      );
    }
    if (this.regions.has(id)) {
      throw new CompileError(`two regions are both named "${id}"`, node);
    }
    return id;
  }

  emitEach(el, out, scope, topLevel) {
    // The loops around this one, not this one. This loop's own variables are
    // created by the block's html.
    const args = this.loopArgs();

    if (this.standalone()) {
      // The id is reserved before the pieces are built, because building them
      // registers any block nested inside the item.
      const id = this.blockDefs.length;
      this.blockDefs.push('');
      this.blockOf.set(el, id);

      // A <template each> renders several nodes per item, so an item is a
      // region rather than a node and needs anchors of its own to be found.
      // Everything else is one element, which is its own delimiter.
      const ranged = el.tagName === 'template';

      this.inBlock++;
      const extra = this.eachPieces(el, scope, topLevel, args, ranged);
      this.inBlock--;

      // html is the loop over item, not a second copy of it. Emitting the
      // markup twice would register every nested block twice, and the second
      // registration would be the one this pass handed on.
      const outer = ['__d', ...args].join(', ');
      this.blockDefs[id] =
        `const __blk${id} = { ${extra}html: (${outer}) => { let __o = ''; let __n = 0; ` +
        `for (const __it of __blk${id}.list(${outer})) __o += __blk${id}.item(${outer}, __it, __n++); ` +
        `return __o; } };`;

      this.s(out, ANCHOR_OPEN);
      this.c(out, `__o += __blk${id}.html(${outer});`);
      this.s(out, ANCHOR_CLOSE);
      return;
    }

    this.emitEachBody(el, out, scope, topLevel);
  }

  /** `list`, `key` and `item`. One loop, taken apart so it can be reconciled. */
  eachPieces(el, scope, topLevel, enclosing, ranged) {
    const spec = parseEach(el.attrs.find((a) => a.name === 'each').value, el);
    const id = ++this.uid;

    const listAst = this.parse(spec.list, el);
    this.note(collectRefs(listAst, scope));
    const listJs = emit(listAst, scope);
    this.warnShadowing(spec, scope, el);

    const itemJs = `_u${id}_${spec.item}`;
    const indexJs = `_u${id}_${spec.index ?? 'index'}`;

    const inner = new Scope(scope);
    inner.declare(spec.item, itemJs);
    if (spec.index) inner.declare(spec.index, indexJs);

    this.loops.push({ item: itemJs, index: indexJs });
    const item = [];
    this.emitElement(el, item, inner, topLevel);
    this.loops.pop();

    const key = el.attrs.find((attr) => attr.name === 'key');
    const outer = ['__d', ...enclosing].join(', ');
    const each = [outer, itemJs, indexJs].join(', ');

    // Without a `key` the position is the key, which is what "unkeyed" has
    // always meant.
    const open = ranged ? JSON.stringify(ANCHOR_OPEN) : `''`;
    const close = ranged ? ` + ${JSON.stringify(ANCHOR_CLOSE)}` : '';

    return (
      `keyed: true, ` +
      (ranged ? `ranged: true, ` : '') +
      `list: (${outer}) => (${listJs}) ?? [], ` +
      `key: (${each}) => ${key ? `(${this.expr(key.value, inner, el)})` : indexJs}, ` +
      `item: (${each}) => { let __o = ${open};\n${joinOut(item).code}\nreturn __o${close}; }, `
    );
  }

  warnShadowing(spec, scope, el) {
    if (!scope.lookup(spec.item)) return;
    this.warn(
      `"${spec.item}" shadows an outer loop variable of the same name; ` +
        `the outer one is unreachable inside this block`,
      el,
    );
  }

  emitEachBody(el, out, scope, topLevel) {
    const spec = parseEach(el.attrs.find((a) => a.name === 'each').value, el);
    const id = ++this.uid;

    const listAst = this.parse(spec.list, el);
    this.note(collectRefs(listAst, scope));
    const listJs = emit(listAst, scope);
    this.warnShadowing(spec, scope, el);

    const itemJs = `_u${id}_${spec.item}`;
    // Always named, whether or not the author asked for it: a block nested in
    // this loop takes it as an argument, and both passes have to agree on how
    // many arguments that is.
    const indexJs = `_u${id}_${spec.index ?? 'index'}`;

    const inner = new Scope(scope);
    inner.declare(spec.item, itemJs);
    if (spec.index) inner.declare(spec.index, indexJs);

    this.loops.push({ item: itemJs, index: indexJs });
    this.c(out, `{ let _n${id} = 0; for (const ${itemJs} of (${listJs}) ?? []) {`);
    this.c(out, `const ${indexJs} = _n${id};`);
    this.emitElement(el, out, inner, topLevel);
    this.c(out, `_n${id}++; } }`);
    this.loops.pop();
  }

  emitElement(el, out, scope, topLevel) {
    assertStaticAttrNames(el);
    const tag = el.tagName;

    // In a layout, <slot> is where the child's content goes. In a component it
    // is a real shadow DOM slot and has to reach the browser untouched.
    if (this.layout && tag === 'slot') {
      const name = el.attrs.find((a) => a.name === 'name')?.value ?? 'default';
      this.consumed.add(name);
      const filled = `__slots[${JSON.stringify(name)}]`;
      const fallback = childrenOf(el);

      if (!fallback.length) {
        this.c(out, `__o += ${filled} ?? '';`);
        return;
      }
      this.c(out, `if (${filled}) { __o += ${filled}; } else {`);
      this.emitChildren(fallback, out, scope, false);
      this.c(out, `}`);
      return;
    }

    // A <template> carrying a directive is structural: consumed, children emitted.
    if (tag === 'template' && directivesOf(el).size > 0) {
      this.emitChildren(childrenOf(el), out, scope, false);
      return;
    }

    if (tag === INCLUDE_TAG) {
      this.emitInclude(el, out, scope);
      return;
    }

    if (this.components.has(tag)) {
      if (this.shadowTags.has(tag)) this.emitShadow(el, out, scope);
      else this.emitLight(el, out, scope);
      return;
    }

    // <title> is kept apart from the rest of the head so the innermost one can
    // win outright, without anything having to re-parse rendered markup.
    let target = out;
    if (topLevel && this.page && HEAD_TAGS.has(tag)) target = tag === 'title' ? this.title : this.head;

    this.s(target, `<${tag}`);
    this.emitAttrs(el, target, scope);
    this.s(target, `>`);

    if (VOID.has(tag)) return;

    if (RAW_TEXT.has(tag)) {
      for (const child of childrenOf(el)) {
        if (child.nodeName === '#text') {
          assertRawTextSafe(tag, child.value ?? '', el);
          this.emitText(child.value ?? '', target, scope, child, true);
        }
      }
    } else {
      this.emitChildren(childrenOf(el), target, scope, false);
    }

    this.s(target, `</${tag}>`);
  }

  emitShadow(el, out, scope) {
    const tag = el.tagName;
    const ref = this.componentRef(tag);

    // Host element: attributes are serialized so the client can re-read them.
    this.s(out, `<${tag}`);
    this.emitAttrs(el, out, scope, ref);
    this.s(out, `>`);

    // Shadow root, server-rendered.
    const props = el.attrs
      .filter((a) => !DIRECTIVES.has(a.name))
      .map((a) => `${JSON.stringify(a.name)}: ${this.attrValueJs(a, scope, el)}`)
      .join(', ');
    this.c(out, `__o += __sh(${ref}, {${props}}${this.fragments ? ', __fragment' : ''});`);

    // Light DOM children fill <slot>.
    this.emitChildren(childrenOf(el), out, scope, false);

    this.s(out, `</${tag}>`);
  }

  /**
   * Light DOM: no shadow root, no template, markup straight into the page. Its
   * children become its default slot, rendered into their own buffer first.
   */
  /**
   * `<transclude src="#pricing">`, the same page's own region, in a second
   * place.
   *
   * This is the case that should cost nothing: the region is already compiled to
   * a function of the page's data, so including it is calling that function.
   * Nothing is fetched, nothing is parsed and the markup cannot drift from the
   * region it came from, because there is only one copy of it.
   */
  emitInclude(el, out, scope) {
    const src = el.attrs?.find((a) => a.name === 'src')?.value ?? null;

    if (src === null || src.trim() === '') {
      throw new CompileError(`<${INCLUDE_TAG}> has no src. It names what to include.`, el);
    }

    // HTML has no self-closing tag outside SVG and MathML, so `/>` is read as
    // `>` and everything after it becomes this element's children. The children
    // are the fallback, so that is silent: the include works and the rest of the
    // page disappears. An element that was never closed at all has the same
    // shape and the same outcome.
    if (el.sourceCodeLocation && !el.sourceCodeLocation.endTag) {
      throw new CompileError(
        `<${INCLUDE_TAG}> is never closed. HTML has no self-closing tag here, so ` +
          `"/>" is read as ">" and the rest of the page is taken as this ` +
          `element's fallback content. Write </${INCLUDE_TAG}>.`,
        el,
      );
    }
    if (!this.page || this.layout) {
      throw new CompileError(
        `<${INCLUDE_TAG}> includes a region of a page, and only a page has regions. ` +
          `Put it in a route rather than in an element or a layout.`,
        el,
      );
    }
    if (/\$\{/.test(src)) {
      throw new CompileError(
        `<${INCLUDE_TAG}> has an interpolated src, so what it includes is not ` +
          `knowable at compile time. Write the id out, or render the markup ` +
          `yourself from the loader.`,
        el,
      );
    }
    if (!src.startsWith('#')) {
      this.emitElsewhere(el, out, scope, src);
      return;
    }

    const id = src.slice(1);
    this.regionIncludes.push({ id, node: el, within: this.inRegion.at(-1) ?? null });

    // The element leaves no trace. A region is several nodes inline and one node
    // wrapping them here would mean the two spellings rendered differently.
    // `false` for the id: the region keeps its name where it is declared, and
    // this copy is the same content rather than a second element answering to
    // `#id`. Two elements with one id would be invalid, and a swap aimed at the
    // region would find whichever came first.
    this.c(out, `__o += regions[${JSON.stringify(id)}](__d, {}, false, false);`);
  }

  /**
   * `<transclude src="https://…#intro">`, a piece of a document somebody
   * else wrote.
   *
   * Resolved before the render rather than during it. Render is synchronous all
   * the way down, and a fetch is not, so what the page declares is collected at
   * compile time and the server has the answers ready by the time render runs.
   * That also means a prerendered page reads the source once, at build time.
   */
  emitElsewhere(el, out, scope, src) {
    const hash = src.indexOf('#');
    if (hash === -1 || hash === src.length - 1) {
      throw new CompileError(
        `<${INCLUDE_TAG} src="${src}"> names a document but no piece of it. ` +
          `Add "#id" to say what to include.`,
        el,
      );
    }

    const id = decodeURIComponent(src.slice(hash + 1));
    const where = src.slice(0, hash);

    if (where.startsWith('/')) {
      // Another route of this app. Rendered here rather than fetched: it is the
      // same process, and going out over HTTP to reach ourselves would run the
      // whole middleware stack to answer a question we can answer directly.
      this.includes.push({ key: src, kind: 'route', where, id, node: el });
    } else {
      let url;
      try {
        url = new URL(where);
      } catch {
        throw new CompileError(
          `<${INCLUDE_TAG} src="${src}"> is none of "#id" for a region of this page, ` +
            `"/path#id" for another route, or an absolute URL for a document elsewhere.`,
          el,
        );
      }
      this.includes.push({ key: src, kind: 'external', where: url.href, id, node: el });
    }

    // Children are the fallback. On success they are dropped; with none, a
    // source that cannot be read stops the render rather than leaving a hole
    // nobody notices.
    const children = childrenOf(el);
    const uid = ++this.uid;
    if (children.length) {
      this.c(out, `const __fb${uid} = (() => { let __o = '';`);
      this.emitChildren(children, out, scope, false);
      this.c(out, `return __o; })();`);
    }

    this.c(
      out,
      `__o += __incl(__d, ${JSON.stringify(src)}, ${children.length ? `__fb${uid}` : 'null'});`,
    );
  }

  emitLight(el, out, scope) {
    const tag = el.tagName;
    const ref = this.componentRef(tag);
    const id = ++this.uid;

    this.s(out, `<${tag}`);
    this.emitAttrs(el, out, scope, ref);
    this.s(out, `>`);

    const children = childrenOf(el);
    if (children.length) {
      this.c(out, `const __sl${id} = (() => { let __o = '';`);
      this.emitChildren(children, out, scope, false);
      this.c(out, `return __o; })();`);
    }

    const props = el.attrs
      .filter((attr) => !DIRECTIVES.has(attr.name))
      .map((attr) => `${JSON.stringify(attr.name)}: ${this.attrValueJs(attr, scope, el)}`)
      .join(', ');

    this.c(
      out,
      `__o += ${ref}.render(__data(${ref}, {${props}}), ` +
        `{ default: ${children.length ? `__sl${id}` : `''`} }` +
        `${this.fragments ? ', __fragment' : ''});`,
    );

    this.s(out, `</${tag}>`);
  }

  /**
   * `ref` is the component this element is, when it is one. Its own converters
   * decide how a value becomes an attribute. The parent has no way to know that a
   * Date crosses as an ISO string rather than as JSON.
   */
  emitAttrs(el, out, scope, ref = null) {
    for (const attr of el.attrs) {
      if (DIRECTIVES.has(attr.name)) continue;

      // The id of a region's own root. It names the region, and a second copy
      // of the region in the same document must not answer to that name too.
      if (attr.name === 'id' && el === this.regionRoot) {
        this.c(out, `__o += __named ? ${JSON.stringify(` id="${attr.value}"`)} : '';`);
        continue;
      }

      const parts = splitInterpolations(attr.value);
      const dynamic = parts.some((p) => p.type === 'expr');

      if (!dynamic) {
        this.s(out, attr.value === '' ? ` ${attr.name}` : ` ${attr.name}="${escapeAttr(attr.value)}"`);
        continue;
      }
      this.c(
        out,
        ref
          ? `__o += __ap(${ref}, ${JSON.stringify(attr.name)}, ${this.attrValueJs(attr, scope, el)});`
          : `__o += __a(${JSON.stringify(attr.name)}, ${this.attrValueJs(attr, scope, el)});`,
      );
    }
  }

  /**
   * `<html lang="en" data-theme="${theme}">` as `{ "lang": "en", "data-theme": theme }`.
   *
   * An object rather than serialized markup, because the chain merges these by
   * name: a root layout setting the theme and a page setting `dir` must both
   * survive, and two `data-theme` attributes in one tag would leave the parser
   * taking the first, which is the outermost. `renderDocument` serializes.
   */
  htmlAttrsJs(el, scope) {
    // <html> is read by a second parse, so it never reaches emitElement.
    assertStaticAttrNames(el);
    const pairs = el.attrs
      .filter((attr) => !DIRECTIVES.has(attr.name))
      .map((attr) => {
        const name = JSON.stringify(attr.name);
        if (attr.value === '') return `${name}: true`;
        return `${name}: ${this.attrValueJs(attr, scope, el)}`;
      });

    return `{ ${pairs.join(', ')} }`;
  }

  // A lone `${expr}` keeps the value's type (arrays/objects/booleans survive to
  // the runtime, which decides how to serialize). Mixed content becomes a concat.
  attrValueJs(attr, scope, el) {
    const parts = splitInterpolations(attr.value);
    if (parts.length === 0) return `""`;
    if (parts.length === 1) {
      return parts[0].type === 'expr'
        ? this.expr(parts[0].value, scope, el)
        : JSON.stringify(parts[0].value);
    }
    return parts
      .map((p) => (p.type === 'expr' ? `__str(${this.expr(p.value, scope, el)})` : JSON.stringify(p.value)))
      .join(' + ');
  }

  emitText(value, out, scope, node, raw) {
    const start = node?.sourceCodeLocation?.startLine ?? this.at;
    let line = start;

    for (const part of splitInterpolations(value)) {
      this.at = line;
      if (part.type === 'text') {
        this.s(out, raw ? part.value : escapeText(part.value));
      } else {
        const js = this.expr(part.value, scope, node);
        this.c(out, raw ? `__o += __str(${js});` : `__o += __e(${js});`);
      }
      // A paragraph of prose is one text node. Counting as we go is what puts a
      // `${}` on line 40 at line 40 rather than at the line the node opened on.
      if (start !== null) line += countNewlines(part.value);
    }
    this.at = start;
  }
}

/**
 * What a `<script>` or a `<style>` may interpolate, which is almost nothing.
 *
 * Text in these two is raw: escaping it would change what the browser reads,
 * since `&amp;` is an ampersand in prose and four characters in JavaScript. So a
 * value lands in code, and one that closes the string it was written into runs
 * whatever follows. No escape fixes that, which is why this refuses.
 *
 * `json()` answers the narrower question, and only as the whole text of a
 * script. A style needs no carve-out, because a custom property is an attribute.
 *
 * @param {string} tag  'script' or 'style'
 * @param {string} text the raw text node's contents
 * @param {object} el   the element, for the line number
 */
function assertRawTextSafe(tag, text, el) {
  const parts = splitInterpolations(text);
  const exprs = parts.filter((p) => p.type === 'expr');
  if (exprs.length === 0) return;

  if (tag === 'script' && parts.length === 1 && isJsonCall(exprs[0].value)) return;

  const alternative =
    tag === 'script'
      ? 'Pass data with ${json(value)}, which is the whole text of the script, ' +
        'or put it in an attribute and read it from a file.'
      : 'Set a custom property on the element instead: ' +
        '<div style="--brand: ${color}">, which is escaped.';

  throw new CompileError(
    `\${} inside <${tag}> is written to the page as code, so a value could end ` +
      `the element or the statement it sits in. ${alternative}`,
    el,
  );
}

/** `json(x)` and nothing else: not `json(x) + y`, and not `notJson(x)`. */
function isJsonCall(source) {
  try {
    const node = parseExpr(source);
    return node.type === 'CallExpression' && node.callee?.type === 'Identifier' && node.callee.name === 'json';
  } catch {
    return false;
  }
}

export const ANCHOR_OPEN = '<!--[-->';
export const ANCHOR_CLOSE = '<!--]-->';

/**
 * `else` / `else-if` bind to the `if` before them, so a chain is one unit. Both
 * passes have to agree on where it ends, so they share the same walk.
 *
 * @param {object[]} nodes
 * @param {number} i where the `if` is
 * @returns {{ chain: Array<{ node: object, kind: string, cond: string|null }>, next: number }|null}
 *   null when the element carries no `if`, so there is no chain to gather
 */
export function gatherChain(nodes, i) {
  const dirs = directivesOf(nodes[i]);
  if (!dirs?.has('if')) return null;

  const chain = [{ node: nodes[i], kind: 'if', cond: dirs.get('if') }];
  let next = i + 1;
  for (;;) {
    const k = nextSignificant(nodes, next);
    if (k < 0) break;
    const d = directivesOf(nodes[k]);
    if (d?.has('else-if')) {
      chain.push({ node: nodes[k], kind: 'else-if', cond: d.get('else-if') });
      next = k + 1;
      continue;
    }
    if (d?.has('else')) {
      // `cond: null` rather than absent, so every entry in the chain is one
      // shape. `emitBranches` reads `kind` to decide, and never reads the
      // condition of an `else`.
      chain.push({ node: nodes[k], kind: 'else', cond: null });
      next = k + 1;
    }
    break;
  }
  return { chain, next };
}

// ---- tree helpers ---------------------------------------------------------

// parse5 puts template children on `.content`, not `.childNodes`. Forgetting
// this silently skips everything inside every template.
/**
 * @param {object} node
 * @returns {object[]} a template's live under `.content`, so walking `childNodes` finds nothing
 */
export function childrenOf(node) {
  if (node.tagName === 'template' && node.content) return node.content.childNodes ?? [];
  return node.childNodes ?? [];
}

function directivesOf(node) {
  if (!node.tagName) return null;
  const found = new Map();
  for (const attr of node.attrs ?? []) {
    if (DIRECTIVES.has(attr.name)) found.set(attr.name, attr.value);
  }
  return found;
}

// else / else-if bind to the previous element, skipping whitespace and comments.
function nextSignificant(nodes, from) {
  for (let i = from; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.nodeName === '#comment') continue;
    if (n.nodeName === '#text' && /^\s*$/.test(n.value ?? '')) continue;
    return n.tagName ? i : -1;
  }
  return -1;
}


function parseEach(value, node) {
  const m = /^\s*([A-Za-z_$][\w$]*)\s*(?:,\s*([A-Za-z_$][\w$]*)\s*)?\s+of\s+([\s\S]+?)\s*$/.exec(value);
  if (!m) {
    throw new CompileError(
      `each="${value}" is malformed. Expected each="item of list" or each="item, index of list"`,
      node,
    );
  }
  return { item: m[1], index: m[2] || null, list: m[3] };
}

// ---- output ---------------------------------------------------------------

/** Newlines in a string, for walking a multi-line text node. */
function countNewlines(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') n += 1;
  return n;
}

/**
 * Chunks to code, and which source line each generated line came from.
 *
 * `.at` is one entry per line of the returned code, so a caller that knows where
 * this block landed in the assembled module can turn it into a mapping. Static
 * chunks are buffered into one `__o +=`, and the line it reports is the first
 * chunk's: that is where the run of markup started.
 */
function joinOut(entries) {
  const lines = [];
  const at = [];
  let buffer = '';
  let bufferAt = null;

  const flush = () => {
    if (!buffer) return;
    lines.push(`__o += ${JSON.stringify(buffer)};`);
    at.push(bufferAt);
    buffer = '';
    bufferAt = null;
  };

  for (const entry of entries) {
    if (entry.t === 's') {
      if (!buffer) bufferAt = entry.at ?? null;
      buffer += entry.v;
      continue;
    }
    flush();
    lines.push(entry.v);
    at.push(entry.at ?? null);
  }
  flush();

  return { code: lines.join('\n'), at };
}

// parse5 hands us decoded text, so static output has to be re-encoded.
function escapeText(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
