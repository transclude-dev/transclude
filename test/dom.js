// A DOM small enough to read, over parse5's tree.
//
// The binding pass computes childNodes indices at compile time, so the only
// question that matters is whether a spec-compliant parser agrees. parse5 is
// that parser; this adds the handful of mutation methods the runtime calls.

import { parseFragment } from 'parse5';

const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);
const RAW_TEXT = new Set(['script', 'style']);

// Focus, only as far as the runtime needs it: an element can hold it, and
// removing a node that contains it drops it — which is what an insertBefore
// move does, and the whole reason the runtime carries focus across one.
let focused = null;

class Node {
  parentNode = null;

  get isConnected() {
    return this.parentNode !== null;
  }
  get nextSibling() {
    const siblings = this.parentNode?.childNodes ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  contains(node) {
    for (let walk = node; walk; walk = walk.parentNode) if (walk === this) return true;
    return false;
  }

  remove() {
    const siblings = this.parentNode?.childNodes;
    if (!siblings) return;
    if (focused && this.contains(focused)) focused = null;
    siblings.splice(siblings.indexOf(this), 1);
    this.parentNode = null;
  }
}

class Comment extends Node {
  nodeType = 8;

  constructor(data) {
    super();
    this.data = data;
  }
}

class Text extends Node {
  nodeType = 3;

  constructor(data) {
    super();
    this.data = data;
  }

  get length() {
    return this.data.length;
  }

  splitText(offset) {
    const node = new Text(this.data.slice(offset));
    this.data = this.data.slice(0, offset);
    const siblings = this.parentNode.childNodes;
    siblings.splice(siblings.indexOf(this) + 1, 0, node);
    node.parentNode = this.parentNode;
    return node;
  }
}

class Element extends Node {
  nodeType = 1;

  constructor(tagName = null) {
    super();
    this.tagName = tagName;
    this.childNodes = [];
    this.attrs = new Map();
  }

  get ownerDocument() {
    return { createTextNode: (data) => new Text(data) };
  }

  focus() {
    focused = this;
  }
  blur() {
    if (focused === this) focused = null;
  }
  get selectionStart() {
    return this.caret ?? null;
  }
  get selectionEnd() {
    return this.caret ?? null;
  }
  setSelectionRange(start) {
    this.caret = start;
  }

  get firstChild() {
    return this.childNodes[0] ?? null;
  }
  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }
  get textContent() {
    return this.childNodes.map((node) => (node instanceof Text ? node.data : node.textContent)).join('');
  }

  getAttribute(name) {
    return this.attrs.has(name) ? this.attrs.get(name) : null;
  }
  setAttribute(name, value) {
    this.attrs.set(name, String(value));
  }
  removeAttribute(name) {
    this.attrs.delete(name);
  }
  hasAttribute(name) {
    return this.attrs.has(name);
  }

  insertBefore(node, reference) {
    node.remove();
    const at = reference ? this.childNodes.indexOf(reference) : this.childNodes.length;
    this.childNodes.splice(at < 0 ? this.childNodes.length : at, 0, node);
    node.parentNode = this;
    return node;
  }

  removeChild(node) {
    node.remove();
    return node;
  }

  replaceChild(node, old) {
    this.insertBefore(node, old);
    old.remove();
    return old;
  }
}

/** Parses markup the way the browser would, and returns a root to bind against. */
export function parseDom(html) {
  return adopt(parseFragment(html), new Element());
}

/** A shadow root the runtime can paint into and the bindings can address. */
export function createRoot() {
  const root = new Element();
  root.setHTMLUnsafe = (markup) => {
    root.childNodes.length = 0;
    adopt(parseFragment(markup), root);
  };
  Object.defineProperty(root, 'html', { get: () => serialize(root) });
  return root;
}

function adopt(source, target) {
  for (const child of source.childNodes ?? []) {
    // Comments are kept: the renderer strips the author's, so the only ones
    // left are the anchors a structural block is addressed by.
    if (child.nodeName === '#comment') {
      target.insertBefore(new Comment(child.data), null);
      continue;
    }

    if (child.nodeName === '#text') {
      const last = target.childNodes[target.childNodes.length - 1];
      if (last instanceof Text) last.data += child.value;
      else target.insertBefore(new Text(child.value), null);
      continue;
    }
    if (!child.tagName) continue;

    const element = new Element(child.tagName);
    for (const attr of child.attrs ?? []) element.attrs.set(attr.name, attr.value);
    target.insertBefore(element, null);

    // A <template>'s children live on .content and are not childNodes.
    if (child.tagName === 'template') continue;
    adopt(child, element);
  }
  return target;
}

/**
 * A `document` with just enough on it for a block update to parse new markup.
 * Returns the undo.
 */
export function installDocument() {
  const previous = globalThis.document;
  globalThis.document = {
    get activeElement() {
      return focused;
    },
    createTextNode: (data) => new Text(data),
    createElement(tagName) {
      const element = new Element(String(tagName).toLowerCase());
      element.setHTMLUnsafe = (html) => {
        element.childNodes.length = 0;
        adopt(parseFragment(html), element);
      };
      return element;
    },
  };
  return () => {
    globalThis.document = previous;
  };
}

/** Back to markup, so a bound update can be compared against a full render. */
export function serialize(node) {
  if (node instanceof Comment) return `<!--${node.data}-->`;
  if (node instanceof Text) {
    const raw = RAW_TEXT.has(node.parentNode?.tagName);
    return raw ? node.data : escapeText(node.data);
  }
  const inner = node.childNodes.map(serialize).join('');
  if (!node.tagName) return inner;

  const attrs = [...node.attrs]
    .map(([name, value]) => (value === '' ? ` ${name}` : ` ${name}="${escapeAttr(value)}"`))
    .join('');
  if (VOID.has(node.tagName)) return `<${node.tagName}${attrs}>`;
  return `<${node.tagName}${attrs}>${inner}</${node.tagName}>`;
}

function escapeText(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
