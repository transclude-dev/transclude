// A second pass over the same parse5 tree the renderer walks, emitting code
// that *updates* the rendered DOM instead of producing it.
//
// The whole point is that nothing has to be discovered at runtime. The compiler
// already knows where every ${} lands, so a binding is a path — no diffing, no
// vdom, and the only thing in the served HTML that exists for the client is a
// pair of comment anchors around each `if` and `each`.
//
// Addressing works in two modes. Where the shape up to a node is known it is
// `parent.childNodes[i]`. Past a block — whose node count is not knowable at
// compile time — the walk switches to a cursor stepping sibling by sibling from
// the block's closing anchor. Both only ever run once: after bind, everything
// is held by reference.
//
// A block is not a wall. Each branch of an `if` and the item of an `each` get
// their own bind/update pair, so a block is re-rendered only when its
// *structure* changes — a different branch, a new key — and its contents are
// written into like anything else. That is what keeps a form field inside an
// `if` from being destroyed because some text beside it changed.
//
// What it will not bind, it reports as `volatile`: prop names whose change
// means the caller repaints the whole shadow root. Being conservative is free.

import { Scope, collectRefs, emit, parseExpr } from './expr.js';
import { splitInterpolations } from './interp.js';
import { childrenOf, gatherChain } from './codegen.js';

const DIRECTIVES = new Set(['if', 'else-if', 'else', 'each', 'key']);
const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);
const RAW_TEXT = new Set(['script', 'style']);
const EACH = /^\s*([A-Za-z_$][\w$]*)\s*(?:,\s*([A-Za-z_$][\w$]*)\s*)?\s+of\s+([\s\S]+?)\s*$/;

export function compileBindings(nodes, opts = {}) {
  const gen = new Bindgen(opts);
  gen.walk(nodes, { parent: '__root', index: opts.rootOffset ?? 0 });
  const root = gen.frame;
  return {
    locate: root.locate.join('\n'),
    writes: root.writes.join('\n'),
    cursors: root.cursors,
    parts: gen.parts.join('\n'),
    volatile: [...gen.volatile].sort(),
  };
}

/** One emission context: the body of bind/update for the template or a part. */
class Frame {
  constructor(scope, loopArgs = []) {
    this.scope = scope;
    // The loop variables a block here would need, in the order codegen emits
    // its parameters. Both passes count two per level, named or not.
    this.loopArgs = loopArgs;
    this.locate = [];
    this.writes = [];
    this.slot = 0;
    this.cursors = 0;
    this.gaveUp = false;
  }
}

class Bindgen {
  constructor({
    components = new Map(),
    shadowTags = new Set(),
    blockOf = new Map(),
    refs = new Map(),
  } = {}) {
    this.components = components;
    this.shadowTags = shadowTags;
    // Which tree node owns which compiled block. Sharing the map is what keeps
    // this pass and the renderer from drifting apart over the same tree.
    this.blockOf = blockOf;
    // tag -> the local name the renderer imported that component under.
    this.refs = refs;
    this.frames = [new Frame(new Scope())];
    this.parts = [];
    this.volatile = new Set();
  }

  get frame() {
    return this.frames[this.frames.length - 1];
  }

  get scope() {
    return this.frame.scope;
  }

  next() {
    return this.frame.slot++;
  }

  cursor() {
    return `__c${this.frame.cursors++}`;
  }

  locate(line) {
    this.frame.locate.push(line);
  }

  write(line) {
    this.frame.writes.push(line);
  }

  // ---- giving up ----------------------------------------------------------

  giveUp(source, scope = this.scope) {
    let ast;
    try {
      ast = parseExpr(source);
    } catch {
      return;
    }
    for (const ref of collectRefs(ast, scope)) {
      if (ref.base === 'data') this.volatile.add(ref.name);
    }
  }

  giveUpText(value, scope = this.scope) {
    for (const part of splitInterpolations(value ?? '')) {
      if (part.type === 'expr') this.giveUp(part.value, scope);
    }
  }

  /**
   * A directive's value is an expression outright, not an interpolation — so
   * `if="tags.length"` has no ${} in it and reading it as text finds nothing.
   */
  giveUpAll(node, scope = this.scope) {
    const attrs = node.attrs ?? [];
    let inner = scope;

    const each = attrs.find((attr) => attr.name === 'each');
    const spec = each && EACH.exec(each.value);
    if (spec) {
      this.giveUp(spec[3], scope);
      inner = new Scope(scope);
      // The name only has to exist for collectRefs to stop calling it data.
      inner.declare(spec[1], spec[1]);
      if (spec[2]) inner.declare(spec[2], spec[2]);
    }

    for (const attr of attrs) {
      if (attr.name === 'each') continue;
      if (attr.name === 'if' || attr.name === 'else-if') {
        this.giveUp(attr.value, scope);
        continue;
      }
      if (attr.name === 'key') {
        this.giveUp(attr.value, inner);
        continue;
      }
      if (attr.name === 'else') continue;
      this.giveUpText(attr.value, inner);
    }

    for (const child of childrenOf(node)) {
      if (child.nodeName === '#text') this.giveUpText(child.value, inner);
      else if (child.tagName) this.giveUpAll(child, inner);
    }
  }

  abandon(slot) {
    if (slot.kind === 'text') {
      for (const node of slot.nodes) this.giveUpText(node.value);
      return;
    }
    for (const node of slot.nodes) this.giveUpAll(node);
  }

  js(source) {
    return emit(parseExpr(source), this.scope);
  }

  // ---- traversal ----------------------------------------------------------

  /**
   * `at` is either `{ parent, index }` — the shape up to here is known — or
   * `{ parent, from }`, a node expression to start stepping from.
   */
  walk(nodes, at) {
    // `bare` means the directive on these nodes has already been consumed by
    // the block that is asking for them. Without it a branch would find its own
    // `if` again and recurse into itself forever.
    const rendered = renderedChildren(nodes, at.bare);
    const parentJs = at.parent;
    let index = at.index ?? 0;
    let cursor = null;

    if (at.from) {
      cursor = this.cursor();
      this.locate(`${cursor} = ${at.from};`);
    }

    for (let i = 0; i < rendered.length; i++) {
      const slot = rendered[i];
      const here = cursor ?? `${parentJs}.childNodes[${index}]`;
      const advance = (from) => {
        if (cursor) this.locate(`${cursor} = ${from}.nextSibling;`);
        else index++;
      };

      if (slot.kind === 'block') {
        const ref = this.bindBlock(slot, here);
        if (ref === null) {
          for (const rest of rendered.slice(i)) this.abandon(rest);
          this.frame.gaveUp = true;
          return;
        }
        // Past a block the node count is not knowable, so addressing becomes
        // relative from here on.
        cursor = cursor ?? this.cursor();
        this.locate(`${cursor} = __b[${ref}].end.nextSibling;`);
        continue;
      }

      if (slot.kind === 'text') {
        const bound = this.bindText(slot, parentJs, here);
        if (!bound) {
          for (const rest of rendered.slice(i)) this.abandon(rest);
          this.frame.gaveUp = true;
          return;
        }
        advance(bound.from ?? here);
        // A split leaves the static tail behind as its own node.
        if (cursor && bound.suffix) this.locate(`${cursor} = ${cursor}.nextSibling;`);
        continue;
      }

      this.bindElement(slot.nodes[0], here, cursor === null);
      advance(here);
    }
  }

  /**
   * The block itself, plus a bind/update pair per branch (or per item) so its
   * contents are written into rather than rebuilt.
   */
  bindBlock(slot, here) {
    const id = this.blockOf.get(slot.nodes[0]);
    if (id === undefined) return null;

    const ref = this.next();
    const args = `[${this.frame.loopArgs.join(', ')}]`;
    this.locate(`__b[${ref}] = __blockAt(${here}, __blk${id}, __d, ${args});`);
    this.write(`__ok = __updateBlock(__b[${ref}], __blk${id}, __d, ${args}) && __ok;`);

    if (slot.each) this.emitItemPart(id, slot.nodes[0]);
    else this.emitBranchParts(id, slot.branches);
    return ref;
  }

  /**
   * Which branch of the chain is showing. The runtime compares it with what it
   * last saw: the same branch means write into it, a different one means
   * rebuild. -1 is "none of them", which an `if` with no `else` can be.
   */
  emitBranchParts(id, branches) {
    const pick = branches.reduceRight(
      (rest, branch, at) =>
        branch.kind === 'else' ? String(at) : `${this.js(branch.cond)} ? ${at} : ${rest}`,
      '-1',
    );
    // The condition may read the loop variables, so pick takes them too — the
    // runtime hands every piece of a block the same arguments.
    const outer = this.frame.loopArgs;
    this.parts.push(`__blk${id}.pick = (${['__d', ...outer].join(', ')}) => (${pick});`);

    const parts = branches.map((branch) => {
      const content = contentOf(branch.node);
      return this.emitPart(content, outer, undefined, content[0] === branch.node, outer);
    });
    if (parts.every(Boolean)) this.parts.push(`__blk${id}.parts = [${parts.join(', ')}];`);
  }

  /** One part, reused for every item the loop produces. */
  emitItemPart(id, element) {
    const spec = EACH.exec(element.attrs.find((attr) => attr.name === 'each').value);
    if (!spec) return;

    const outer = this.frame.loopArgs;
    const depth = outer.length / 2;
    const item = `__it${depth}`;
    const index = `__i${depth}`;

    const scope = new Scope(this.scope);
    scope.declare(spec[1], item);
    if (spec[2]) scope.declare(spec[2], index);

    const inner = [...outer, item, index];
    // Same shape as a branch: the element itself, whose `each` is already
    // consumed, or a template's content, which carries no directive at all.
    const content = contentOf(element);
    const part = this.emitPart(content, inner, scope, content[0] === element, inner);
    if (part) this.parts.push(`__blk${id}.parts = [${part}];`);
  }

  /**
   * A part is bind/update over a run of nodes starting at a node handed in
   * rather than at a known index. Null where anything inside could not be
   * bound, which leaves the block re-rendering whole — correct, just not
   * surgical.
   */
  emitPart(nodes, extra, scope = new Scope(this.scope), bare = false, loopArgs = []) {
    this.frames.push(new Frame(scope, loopArgs));
    const frame = this.frame;

    this.locate('const __p = __n.parentNode;');
    this.walk(nodes, { parent: '__p', from: '__n', bare });
    this.frames.pop();

    if (frame.gaveUp) return null;

    const args = ['__d', ...extra].join(', ');
    const cursors = frame.cursors
      ? `let ${Array.from({ length: frame.cursors }, (_, i) => `__c${i}`).join(', ')};\n`
      : '';
    return (
      `{ bind: (__n, ${args}) => { const __b = [];\n${cursors}${frame.locate.join('\n')}\n` +
      `return __b; }, update: (__b, ${args}) => { let __ok = true;\n` +
      `${frame.writes.join('\n')}\nreturn __ok; } }`
    );
  }

  /**
   * A ${} in mixed content is not its own text node — `Hello ${name}!` is one
   * node reading "Hello Ada!". Both static sides have compile-time known
   * lengths, so the dynamic middle splits out of it exactly.
   *
   * Two or more of them have no findable boundary between them, so the whole
   * node is rewritten instead. Same result, one node rather than five.
   */
  bindText(slot, parentJs, here) {
    const combined = slot.nodes.map((node) => node.value ?? '').join('');
    const parts = splitInterpolations(combined);
    const exprs = parts.filter((part) => part.type === 'expr');

    if (!exprs.length) return { from: null, suffix: 0 };

    let sources;
    try {
      sources = parts.map((part) =>
        part.type === 'expr' ? this.js(part.value) : JSON.stringify(part.value),
      );
    } catch {
      return null;
    }

    if (exprs.length > 1) {
      const ref = this.next();
      this.locate(`__b[${ref}] = __textAt(${parentJs}, ${here}, 0, 0);`);
      this.write(`__ok = __setParts(__b[${ref}], [${sources.join(', ')}]) && __ok;`);
      return { from: `__b[${ref}]`, suffix: 0 };
    }

    const at = parts.indexOf(exprs[0]);
    const prefix = parts.slice(0, at).reduce((n, part) => n + part.value.length, 0);
    const suffix = parts.slice(at + 1).reduce((n, part) => n + part.value.length, 0);

    const ref = this.next();
    this.locate(`__b[${ref}] = __textAt(${parentJs}, ${here}, ${prefix}, ${suffix});`);
    this.write(`__ok = __setText(__b[${ref}], ${sources[at]}) && __ok;`);
    return { from: `__b[${ref}]`, suffix };
  }

  bindElement(node, nodeExpr, stable) {
    const tag = node.tagName;
    const isComponent = this.components.has(tag);
    // A light component's children in the DOM are its *own* rendered markup,
    // not what we emitted here, and nothing repaints when its attributes
    // change. A shadow one owns its shadow root and reacts to its attributes,
    // so writing one is how an update reaches down into it.
    const light = isComponent && !this.shadowTags.has(tag);

    let ref = null;
    // `update` runs long after `bind` returned, so anything it touches has to be
    // held in the bindings array — a path like `__root.childNodes[0]` means
    // nothing there.
    const slotFor = () => {
      if (ref === null) {
        ref = this.next();
        this.locate(`__b[${ref}] = ${nodeExpr};`);
      }
      return `__b[${ref}]`;
    };
    // Descending only ever happens inside `bind`, so a stable path is fine.
    const parentExpr = () => (ref !== null ? `__b[${ref}]` : stable ? nodeExpr : slotFor());

    for (const attr of node.attrs ?? []) {
      if (DIRECTIVES.has(attr.name)) continue;
      const parts = splitInterpolations(attr.value);
      if (!parts.some((part) => part.type === 'expr')) continue;

      if (light) {
        this.giveUpText(attr.value);
        continue;
      }

      let value;
      try {
        value =
          parts.length === 1
            ? this.js(parts[0].value)
            : parts
                .map((part) =>
                  part.type === 'expr' ? `__str(${this.js(part.value)})` : JSON.stringify(part.value),
                )
                .join(' + ');
      } catch {
        this.giveUpText(attr.value);
        continue;
      }
      // A shadow child reads its attributes back through its own converters,
      // so an update has to write them the way it will read them.
      const childRef = this.refs.get(tag) ?? null;
      this.write(
        childRef
          ? `__setAttrProp(${childRef}, ${slotFor()}, ${JSON.stringify(attr.name)}, ${value});`
          : `__setAttr(${slotFor()}, ${JSON.stringify(attr.name)}, ${value});`,
      );
    }

    if (VOID.has(tag)) return;

    // A component renders its own insides; a plain <template> keeps its content
    // in a DocumentFragment nothing here can address; raw text is not markup.
    if (isComponent || tag === 'template' || RAW_TEXT.has(tag)) {
      for (const child of childrenOf(node)) {
        if (child.nodeName === '#text') this.giveUpText(child.value);
        else if (child.tagName) this.giveUpAll(child);
      }
      return;
    }

    const children = childrenOf(node);
    if (children.length) this.walk(children, { parent: parentExpr(), index: 0 });
  }
}

// ---- helpers --------------------------------------------------------------

/** What a branch or an item renders: itself, or a template's content. */
function contentOf(node) {
  return node.tagName === 'template' ? childrenOf(node) : [node];
}

/**
 * The child list as the browser will build it: comments are dropped by the
 * renderer, adjacent text runs become one node, and an if/else chain is a
 * single region — including the whitespace between its branches, which the
 * renderer never emits.
 */
function renderedChildren(nodes, bare = false) {
  const out = [];
  let i = 0;

  while (i < nodes.length) {
    const node = nodes[i];

    const chain = !bare && node.tagName ? gatherChain(nodes, i) : null;
    if (chain) {
      out.push({
        kind: 'block',
        nodes: chain.chain.map((branch) => branch.node),
        branches: chain.chain,
      });
      i = chain.next;
      continue;
    }
    i++;

    if (node.nodeName === '#comment') continue;

    if (node.nodeName === '#text') {
      const last = out[out.length - 1];
      if (last?.kind === 'text') last.nodes.push(node);
      else out.push({ kind: 'text', nodes: [node] });
      continue;
    }
    if (!node.tagName) continue;

    const each = !bare && (node.attrs ?? []).some((attr) => attr.name === 'each');
    const structural = !bare && (node.attrs ?? []).some((attr) => DIRECTIVES.has(attr.name));
    out.push({ kind: structural ? 'block' : 'element', nodes: [node], each });
  }
  return out;
}
