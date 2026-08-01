// Runtime shared by the server render and the browser custom element.
// Nothing here touches `document` at module scope, so it imports cleanly in Node.

const ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

class RawHtml {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

/** Opt out of escaping: `${html(post.body)}`. The only way to inject markup. */
export function html(value) {
  return new RawHtml(value == null ? '' : String(value));
}

/** Every `${}` in text position goes through this. */
export function escape(value) {
  if (value == null || value === false) return '';
  if (value instanceof RawHtml) return value.value;
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** Interpolation inside a larger string (mixed attribute values, raw text). */
export function str(value) {
  if (value == null || value === false) return '';
  if (value instanceof RawHtml) return value.value;
  return String(value);
}

/**
 * Dynamic attribute. false, null and undefined drop the attribute rather than
 * becoming a string, or you get class="false" in the output.
 * true emits a bare boolean attribute. Objects/arrays serialize as JSON so the
 * client can read them back off the element.
 */
export function attr(name, value) {
  if (value == null || value === false) return '';
  if (value === true) return ` ${name}`;
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return ` ${name}="${text.replace(/[&<>"]/g, (c) => ESCAPES[c])}"`;
}

/**
 * `pageSize` <-> `page-size`. HTML lowercases attribute names, so a camelCase
 * prop would never match the attribute it came from. Lit has the same rule, for
 * the same reason.
 */
export function attrName(prop) {
  return /[A-Z]/.test(prop) ? prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`) : prop;
}

/**
 * Attributes are strings; prop defaults tell us what they should have been.
 *
 * The default's own type covers string, number, boolean and anything JSON
 * round-trips. A `from` in the block's `attributes` export takes over for
 * everything else, such as a Date, a Set or a comma-separated list. There is no
 * type the framework could have guessed those from.
 */
export function coerceProps(defs, props, specs) {
  const out = {};
  const claimed = new Set();

  for (const key of Object.keys(defs ?? {})) {
    const fallback = defs[key];
    const attr = attrName(key);
    claimed.add(attr).add(key);

    // Either spelling: the DOM reports the attribute, a template passes what
    // the author wrote.
    let value = props?.[attr] ?? props?.[key];

    if (value === undefined || value === null) {
      out[key] = fallback;
      continue;
    }
    if (typeof value === 'string') {
      const from = specs?.[key]?.from;
      if (from) {
        // A malformed attribute is the author's to see, not the page's to break
        // on: the declared default is a defined answer.
        try {
          value = from(value);
        } catch {
          value = fallback;
        }
      } else if (typeof fallback === 'number') value = Number(value);
      else if (typeof fallback === 'boolean') value = value !== 'false';
      else if (fallback && typeof fallback === 'object') {
        try {
          value = JSON.parse(value);
        } catch {
          value = fallback;
        }
      }
    }
    out[key] = value;
  }
  for (const key of Object.keys(props ?? {})) {
    if (!claimed.has(key) && !(key in out)) out[key] = props[key];
  }
  return out;
}

// ---- updates in place -----------------------------------------------------
//
// The compiler emits a `bind` that locates every node an expression owns, and
// an `update` that writes to them. Nothing is destroyed, so focus, selection,
// scroll position, input values, media playback and running animations all
// survive a change that used to replace the whole shadow root.

/**
 * The text node a ${} owns, carved out of the one the parser actually built.
 *
 * `Hello ${name}!` is a single text node reading "Hello Ada!". Both static
 * sides have lengths known at compile time, so the dynamic middle splits out
 * exactly. No marker comments in the served HTML, and nothing evaluated.
 */
export function textAt(parent, node, prefix, suffix) {
  // An expression that rendered to nothing left no text node behind, and every
  // index after it would be short by one. Putting an empty one back is what
  // keeps every path after it correct.
  if (!node || node.nodeType !== 3) {
    const text = (parent.ownerDocument ?? document).createTextNode('');
    parent.insertBefore(text, node ?? null);
    node = text;
  }
  if (prefix) node = node.splitText(prefix);
  if (suffix) node.splitText(node.length - suffix);
  return node;
}

/** False means the value cannot live in a text node, so the caller repaints. */
export function setText(node, value) {
  if (value instanceof RawHtml) return false;
  const text = str(value);
  if (node.data !== text) node.data = text;
  return true;
}

/** The update-time counterpart of attr(), with the same rules. */
export function setAttr(element, name, value) {
  if (value === null || value === undefined || value === false) {
    element.removeAttribute(name);
    return;
  }
  if (value === true) {
    if (!element.hasAttribute(name)) element.setAttribute(name, '');
    return;
  }
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (element.getAttribute(name) !== text) element.setAttribute(name, text);
}

/** Several ${} in one text node: rewrite the whole thing rather than split it. */
export function setParts(node, parts) {
  let text = '';
  for (const part of parts) {
    if (part instanceof RawHtml) return false;
    text += str(part);
  }
  if (node.data !== text) node.data = text;
  return true;
}

// ---- structural blocks ----------------------------------------------------
//
// `if` and `each` change how many nodes there are, so they cannot be addressed
// by a compile-time index. Each one is wrapped in a pair of comment anchors at
// render time, and owns everything between them. That is the only thing in the
// served HTML that exists for the client's benefit. 14 bytes per block, and only
// in components.

/** The matching closing anchor, counting nested ones on the way. */
function closingAnchor(open) {
  let depth = 0;
  for (let node = open; node; node = node.nextSibling) {
    if (node.nodeType !== 8) continue;
    if (node.data === '[') depth++;
    else if (node.data === ']' && --depth === 0) return node;
  }
  return null;
}

/**
 * An item spans one node or, where it renders several, the region between its
 * own anchors. Everything downstream works on the range, so a single-element
 * item is just the case where first and last are the same node.
 */
function entryAt(block, first) {
  const last = block.ranged ? closingAnchor(first) : first;
  return last && { first, last, bindings: null, html: null };
}

const bindsFrom = (block, entry) => (block.ranged ? entry.first.nextSibling : entry.first);

export function blockAt(open, block, props, args = []) {
  const end = closingAnchor(open);
  const state = { start: open, end, html: null, keyed: null, branch: -1, bindings: null };
  if (block.keyed) {
    state.keyed = adoptKeyed(state, block, props, args);
    return state;
  }

  // Which branch the server rendered, so the first update can tell a change of
  // structure from a change of content.
  state.branch = block.pick ? block.pick(props, ...args) : 0;
  const part = block.parts?.[state.branch];
  if (part) state.bindings = part.bind(state.start.nextSibling, props, ...args);
  // Without a part there is nothing to write into, so the rendered markup is
  // the only thing left to compare against.
  else state.html = block.html(props, ...args);
  return state;
}

/** Pairs the nodes already in the document with the list that produced them. */
function adoptKeyed(state, block, props, args) {
  const owned = new Map();
  const part = block.parts?.[0];
  let node = state.start.nextSibling;
  let index = 0;

  for (const item of block.list(props, ...args)) {
    if (!node || node === state.end) break;
    const entry = entryAt(block, node);
    if (!entry) break;

    if (part) entry.bindings = part.bind(bindsFrom(block, entry), props, ...args, item, index);
    else entry.html = block.item(props, ...args, item, index);

    owned.set(block.key(props, ...args, item, index), entry);
    node = entry.last.nextSibling;
    index++;
  }
  return owned;
}

export function updateBlock(state, block, props, args = []) {
  if (!state.end) return false;
  if (block.keyed) return updateKeyed(state, block, props, args);

  const branch = block.pick ? block.pick(props, ...args) : 0;
  const part = block.parts?.[branch];

  // Same branch: its contents are bindings like any others, so nothing here is
  // destroyed and a focused field inside it stays focused.
  if (branch === state.branch && part && state.bindings) {
    if (part.update(state.bindings, props, ...args)) return true;
  } else if (branch === state.branch && !part) {
    const html = block.html(props, ...args);
    if (html === state.html) return true;
    state.html = html;
  }

  const html = block.html(props, ...args);
  render(state, html);
  state.branch = branch;
  state.bindings = part ? part.bind(state.start.nextSibling, props, ...args) : null;
  if (!part) state.html = html;
  return true;
}

/** Replaces everything between the anchors. */
function render(state, html) {
  const parent = state.start.parentNode;
  while (state.start.nextSibling && state.start.nextSibling !== state.end) {
    parent.removeChild(state.start.nextSibling);
  }
  const holder = parseInContext(parent, html);
  while (holder.firstChild) parent.insertBefore(holder.firstChild, state.end);
}

/**
 * Reordering reuses the nodes a key already owns. `moveBefore` moves them without
 * resetting anything. An iframe keeps loading, focus stays, and a running
 * animation keeps running. Plain insertBefore cannot promise that.
 */
function updateKeyed(state, block, props, args) {
  const parent = state.start.parentNode;
  const previous = state.keyed;
  const part = block.parts?.[0];
  const owned = new Map();
  const restoreFocus = captureFocus(parent);

  /**
   * Inserted before it is bound, on purpose. A part reads `__n.parentNode` to find
   * where its own top-level nodes live, and before insertion that is the scratch
   * element the markup was parsed in.
   */
  const build = (item, index, reference) => {
    const html = block.item(props, ...args, item, index);
    const nodes = [...parseInContext(parent, html).childNodes];
    for (const node of nodes) parent.insertBefore(node, reference);

    const entry = { first: nodes[0], last: nodes[nodes.length - 1], bindings: null, html: null };
    if (part) entry.bindings = part.bind(bindsFrom(block, entry), props, ...args, item, index);
    else entry.html = html;
    return entry;
  };

  let reference = state.start.nextSibling;
  let index = 0;

  for (const item of block.list(props, ...args)) {
    const key = block.key(props, ...args, item, index);
    // A repeated key owns one row; the second claim on it has to build its own.
    let entry = owned.has(key) ? undefined : previous.get(key);

    if (!entry) {
      // Built straight into position, so it needs no move afterwards.
      entry = build(item, index, reference);
      owned.set(key, entry);
      index++;
      continue;
    }

    // An item whose content changed is written into, not replaced. The row keeps
    // its identity, and with it anything the user was doing in it.
    const wrote = part
      ? part.update(entry.bindings, props, ...args, item, index)
      : entry.html === block.item(props, ...args, item, index);

    if (!wrote) {
      const inPlace = reference === entry.first;
      const replacement = build(item, index, entry.first);
      removeRange(entry);
      entry = replacement;
      if (inPlace) reference = entry.last.nextSibling;
      else moveRange(parent, entry, reference);
    } else if (entry.first === reference) {
      reference = entry.last.nextSibling;
    } else {
      moveRange(parent, entry, reference);
    }

    owned.set(key, entry);
    index++;
  }

  for (const [key, entry] of previous) {
    if (owned.get(key) !== entry) removeRange(entry);
  }
  state.keyed = owned;
  restoreFocus?.();
  return true;
}

function moveRange(parent, entry, reference) {
  const stop = entry.last.nextSibling;
  let node = entry.first;
  while (node && node !== stop) {
    // Captured before the move, which is what changes it.
    const next = node.nextSibling;
    place(parent, node, reference);
    node = next;
  }
}

function removeRange(entry) {
  const stop = entry.last.nextSibling;
  let node = entry.first;
  while (node && node !== stop) {
    const next = node.nextSibling;
    node.remove();
    node = next;
  }
}

/**
 * The focused element, following shadow roots down. `document.activeElement`
 * only ever names the outermost host.
 */
function deepActiveElement() {
  if (typeof document === 'undefined') return null;
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active ?? null;
}

/**
 * Where `moveBefore` is unavailable, a move is a removal followed by an insert,
 * and removing a node blurs whatever was focused inside it.
 *
 * Measured, focus is the only thing lost. The node itself is reused, and its
 * value, its selection, its shadow root and its component state all come through.
 * So focus is the one thing worth carrying across by hand. Where `moveBefore`
 * exists, none of this runs.
 */
function captureFocus(parent) {
  if (parent.moveBefore) return null;

  const active = deepActiveElement();
  if (!active) return null;

  let start = null;
  let end = null;
  try {
    start = active.selectionStart;
    end = active.selectionEnd;
  } catch {
    // Not a field with a selection; focus alone is what there is to restore.
  }

  return () => {
    if (!active.isConnected || deepActiveElement() === active) return;
    active.focus({ preventScroll: true });
    if (typeof start === 'number') {
      try {
        active.setSelectionRange(start, end);
      } catch {
        // Same as above.
      }
    }
  };
}

function place(parent, node, reference) {
  if (parent.moveBefore && node.isConnected) {
    try {
      parent.moveBefore(node, reference);
      return;
    } catch {
      // Not movable in this position; falling back loses state but stays correct.
    }
  }
  parent.insertBefore(node, reference);
}

/**
 * Parsing has to happen inside an element of the same kind as the destination,
 * or the parser drops what cannot live there. A bare <tr> in a <div> is thrown
 * away.
 */
function parseInContext(parent, html) {
  const holder = document.createElement(parent.nodeType === 1 ? parent.tagName : 'div');
  if (holder.setHTMLUnsafe) holder.setHTMLUnsafe(html);
  else holder.innerHTML = html;
  return holder;
}

// ---- internal state -------------------------------------------------------
//
// A prop is an attribute, and the attribute is the only copy of it. State is
// the other half: a field that lives on the instance, is not in the document,
// and is nobody's business but the component's. Assigning one schedules a
// render the same way an attribute change does.
//
// Kept in a WeakMap rather than a private field so the accessors can be
// generated from outside the class body, like the prop ones are.

const STATE = new WeakMap();

export function stateOf(element, defs) {
  let state = STATE.get(element);
  if (!state) {
    state = { ...defs };
    STATE.set(element, state);
  }
  return state;
}

function defineState(Class, defs, schedule) {
  for (const key of Object.keys(defs ?? {})) {
    if (key in Class.prototype) {
      throw new Error(
        `<script state>: \`${key}\` already exists on the element. Pick another name.`,
      );
    }
    Object.defineProperty(Class.prototype, key, {
      get() {
        return stateOf(this, defs)[key];
      },
      set(value) {
        const state = stateOf(this, defs);
        if (Object.is(state[key], value)) return;
        state[key] = value;
        schedule(this);
      },
      enumerable: true,
      configurable: true,
    });
  }
}

/**
 * Whether anything the compiler could not bind has changed. Compared as raw
 * attribute strings rather than coerced values: an object prop coerces to a
 * fresh object every time, which would read as a change on every update.
 */
function volatileChanged(names, next, prev, state, prevState) {
  for (const name of names ?? []) {
    // A volatile name is whatever the template read. That may be state, and state
    // has no attribute to compare.
    if (name in state) {
      if (!Object.is(state[name], prevState[name])) return true;
    } else if (next[attrName(name)] !== prev[attrName(name)]) {
      return true;
    }
  }
  return false;
}

/** The inverse: writing a property back to the attribute that backs it. */
export function writeProp(element, prop, value, fallback, specs) {
  const attr = attrName(prop);

  const to = specs?.[prop]?.to;
  if (to) {
    // setAttr already knows what false, null and true mean for an attribute.
    setAttr(element, attr, to(value));
    return;
  }
  if (typeof fallback === 'boolean') {
    element.toggleAttribute(attr, Boolean(value));
    return;
  }
  if (value === null || value === undefined) {
    element.removeAttribute(attr);
    return;
  }
  element.setAttribute(attr, typeof value === 'object' ? JSON.stringify(value) : String(value));
}

/**
 * An accessor per declared prop, generated from `<script props>`. The shape is
 * already stated there, so writing a getter and setter for each would say the
 * same thing twice.
 *
 * The attribute is the only state. A getter reads and coerces it; a setter
 * writes it, which for a component triggers attributeChangedCallback and a
 * re-render, and for a partial drives attribute selectors in CSS. Nothing is
 * mirrored, so nothing can drift.
 */
function defineProps(Class, defs, specs) {
  for (const [prop, fallback] of Object.entries(defs ?? {})) {
    const attr = attrName(prop);
    const single = { [prop]: fallback };

    Object.defineProperty(Class.prototype, prop, {
      get() {
        return coerceProps(single, { [attr]: this.getAttribute(attr) }, specs)[prop];
      },
      set(value) {
        writeProp(this, prop, value, fallback, specs);
      },
      enumerable: true,
      configurable: true,
    });
  }
}

/**
 * `export const prototype` is an object; its members land on the class prototype
 * so they are shared, inherited, and visible to `in`.
 *
 * Descriptors, not `Object.assign`. Assigning would call every getter once at
 * define time and copy the results as plain values.
 *
 * The collision check is `in`, which walks the whole chain up through
 * HTMLElement. That is exhaustive and needs no table of DOM member names to
 * fall out of date. It catches a clash with a declared prop too, since
 * defineProps has already run.
 */
function defineMembers(Class, members, tag) {
  const descriptors = Object.getOwnPropertyDescriptors(members ?? {});

  for (const name of Object.keys(descriptors)) {
    if (name in Class.prototype) {
      throw new Error(
        `<${tag}>: \`${name}\` in \`export const prototype\` would shadow ` +
          `something the element already has. Pick another name.`,
      );
    }
    Object.defineProperty(Class.prototype, name, {
      ...descriptors[name],
      enumerable: false,
      configurable: true,
    });
  }
}

/**
 * The prop an attribute name belongs to. Without a rename the mapping is just
 * dash-casing, so this reverses it, over a handful of declared names.
 */
function propFor(def, attr) {
  return Object.keys(def.propDefs ?? {}).find((key) => attrName(key) === attr);
}

/**
 * A component's attribute, serialized the way that component reads it back.
 * The parent's template cannot know that a Date crosses the boundary as an ISO
 * string rather than as JSON. The child's `to` does.
 */
export function attrProp(def, name, value) {
  const to = def.propAttrs?.[propFor(def, name)]?.to;
  return attr(name, to ? to(value) : value);
}

/** The same, for an update writing into an already-rendered child. */
export function setAttrProp(def, element, name, value) {
  const to = def.propAttrs?.[propFor(def, name)]?.to;
  setAttr(element, name, to ? to(value) : value);
}

/**
 * Server side of the component: the shadow root, inline, so the page is correct
 * before any JS runs. Nested DSD works because the HTML parser handles it.
 *
 * Except in a fragment. A fragment is swapped into a document that is already
 * live, and nothing that does the swapping processes a declarative shadow root.
 * Not innerHTML, not DOMParser, and none of the libraries built on them. The
 * template would land dead and the component would never exist.
 *
 * So a fragment ships the element bare: the tag and its attributes, nothing
 * inside. `connectedCallback` finds no shadow root, attaches one and paints,
 * and that paint goes through setHTMLUnsafe, which does process the nested
 * declarative roots underneath it. Nothing is lost by leaving it out. Server
 * rendering buys a correct first paint, and a fragment arrives long after first
 * paint.
 */
export function shadow(def, props, fragment = false) {
  if (fragment) return '';
  const styles = def.css ? `<style>${def.css}</style>` : '';
  return `<template shadowrootmode="open">${styles}${def.render(data(def, props))}</template>`;
}

/**
 * What a template sees, on the server: state defaults under the props.
 *
 * The same order the element uses once it is live, so the first paint and every
 * later one read the same shape. Rendering props alone wrote `undefined` wherever
 * a template named state.
 */
export function data(def, props) {
  return { ...def.stateDefs, ...def.coerce(props) };
}

/**
 * A partial rendered for insertion into a live document: its own light markup,
 * with any component inside it left bare for the client to paint.
 *
 * Its styles are left out on purpose. They are one `<style>` per tag in <head>,
 * not one per use, so putting them here would ship a copy on every swap. When the
 * swapped markup names a partial the document has never rendered, `watch` notices
 * the tag and `adoptStyles` adds them once.
 */
/**
 * What an external include renders: the fragment the server fetched, the
 * element's own children if it could not be read, or a throw if there are
 * neither.
 *
 * A page with no fallback that silently rendered a hole would be worse than one
 * that fails: the hole looks like content nobody wrote.
 */
export function included(data, key, fallback) {
  const html = data?.__included?.[key];
  if (html != null) return html;
  if (fallback !== null) return fallback;

  throw new Error(
    `[transclude] <transclude-fragment src="${key}"> could not be read, and the ` +
      `element has no children to fall back to.`,
  );
}

export function fragment(def, props = {}, slots = {}) {
  return def.render(data(def, props), slots, true);
}

/**
 * A light element's styles, in <head>, at most once per tag.
 *
 * The server writes the same `<style data-transclude="tag">` for every light element the
 * document rendered, so the marker is the whole agreement. If one is already
 * there, these styles are applied and this does nothing. That is why the
 * attribute is on the server's output too. A page that renders <site-note> and a
 * swap that brings one in must not end up with two copies.
 *
 * Inserted *before* the document's own <style>, not appended, because that is
 * where the server would have put it: a page's rules override an element's.
 */
export function adoptStyles(def) {
  if (typeof document === 'undefined') return;
  if (!def.light || !def.css) return;
  if (document.querySelector(`style[data-transclude="${def.tag}"]`)) return;

  const style = document.createElement('style');
  style.setAttribute('data-transclude', def.tag);
  style.textContent = def.css;
  document.head.insertBefore(style, document.querySelector('style[data-transclude-page]'));
}

/**
 * Loads element definitions for tags that arrive after the page did.
 *
 * A page's client entry defines what the page can render. A fragment swapped in
 * from another route can contain anything, and it arrives as plain markup. A
 * partial arrives with no styles, a component with no definition.
 *
 * The framework does not do the swapping. Whoever does, whether htmx, Turbo or a
 * short fetch, cannot be counted on to announce it, and half of them use plain
 * innerHTML. So this watches the result rather than the cause. Whatever put the
 * tag in the document, it is in the document, and that is the signal. It is the one piece of client code that exists to make somebody
 * else's swapper work.
 *
 * `loaders` is tag -> dynamic import, so a tag that never appears costs one
 * string. The observer disconnects once every tag it knows about has been seen.
 *
 * It does not look inside shadow roots. It does not need to: a component's own
 * `define` brings the elements it renders with it.
 */
export function watch(loaders, root = globalThis.document) {
  if (!root || typeof MutationObserver === 'undefined') return () => {};

  const pending = new Set(Object.keys(loaders));
  if (!pending.size) return () => {};

  const observer = new MutationObserver(() => sweep());
  const stop = () => observer.disconnect();

  function sweep() {
    for (const tag of pending) {
      if (!root.querySelector(tag)) continue;
      pending.delete(tag);
      // A failed chunk should say so and not take the sweep down with it. Every
      // other tag on the page is independent of this one.
      Promise.resolve()
        .then(loaders[tag])
        .then((mod) => mod?.define?.())
        .catch((err) => console.error(`[transclude] could not define <${tag}>`, err));
    }
    if (!pending.size) stop();
  }

  observer.observe(root.documentElement ?? root, { childList: true, subtree: true });
  sweep();
  return stop;
}

/**
 * Client side of the same component. On first connect the shadow root already
 * exists, because the parser attached it from the DSD template, so nothing
 * repaints. Rendering it on the server is what makes that possible.
 */
/**
 * A light element has no shadow root to repaint, and repainting would destroy
 * the children the page put inside it. So it upgrades for behaviour only: the
 * markup it was served is the markup it keeps.
 */
export function defineLight(def, init) {
  // Before every other exit below: styles are the half of this that a partial
  // with no behaviour still has, and the half a swapped-in one arrives without.
  adoptStyles(def);

  if (typeof customElements === 'undefined') return;
  if (customElements.get(def.tag)) return;
  // No behaviour to attach means nothing to register. A light element with no
  // <script> is markup that was already rendered, and it ships no JavaScript at
  // all, accessors included. That is the trade the
  // zero-JS default makes.
  //
  // Being a form control counts as behaviour: a shadow root is not required to be
  // one, and an element that submits a value has to exist to do it.
  if (!init && !hasMembers(def) && !def.formAssociated && !hasState(def)) return;

  class Light extends HTMLElement {
    // Every declared prop, so a change reaches the template. A light element
    // that ships no JavaScript is never registered at all, so nothing here costs
    // a page that does not already have a script on it.
    static observedAttributes = Object.keys(def.propDefs ?? {}).map(attrName);
    static formAssociated = def.formAssociated === true;

    #internals = null;
    #cleanup = null;
    #abort = null;
    #bindings = null;
    #bound = false;
    #ready = false;
    #raw = null;
    #was = null;
    #pending = null;
    #settle = null;

    constructor() {
      super();
      if (def.formAssociated) this.#internals = this.attachInternals();
    }

    get internals() {
      return this.#internals;
    }

    reportFormValue() {
      if (!this.#internals) return;
      const value = formValueOf(def, this);
      if (value !== undefined) this.#internals.setFormValue(value);
    }

    /** Resolves once the changes made so far have been written. */
    get updateComplete() {
      return this.#pending ?? Promise.resolve();
    }

    /** One render per microtask, so `a = 1; b = 2` writes once. */
    schedule() {
      if (this.#pending) return;
      this.#pending = new Promise((resolve) => {
        this.#settle = resolve;
      });
      queueMicrotask(() => {
        const settle = this.#settle;
        this.#pending = null;
        this.#settle = null;
        if (this.#ready) this.#apply();
        settle();
      });
    }

    attributeChangedCallback() {
      // Before the render, the same as a component: a form can be submitted
      // between the change and the microtask that writes it.
      this.reportFormValue();
      if (this.#ready) this.schedule();
    }

    connectedCallback() {
      // The markup is already right, so this only finds the nodes each
      // expression owns. Once: moving an element reconnects it, and binding a
      // second time would split an already split text node.
      if (!this.#bound) {
        this.#raw = this.#snapshot();
        this.#bindings = def.bind ? def.bind(this, this.#data(this.#raw)) : null;
        this.#bound = true;
      }

      this.#ready = true;
      this.#abort = new AbortController();
      this.#cleanup = init?.(this, null, this.#abort.signal, this.#internals);
      this.reportFormValue();
      this.updated?.();
    }

    /**
     * Writes to the nodes that are already there, and only those.
     *
     * There is no repaint here. Replacing the children would throw away what the
     * caller slotted in and anything the page did to them, and a light element
     * does not own its children. The compiler refuses a template that would need
     * one, so reaching that case means a binding the compiler could not make.
     */
    #apply() {
      const raw = this.#snapshot();
      if (this.#bindings) def.update(this.#bindings, this.#data(raw));
      this.updated?.();
    }

    #data(raw) {
      this.#was = { ...stateOf(this, def.stateDefs) };
      return { ...this.#was, ...def.coerce(raw) };
    }

    #snapshot() {
      const raw = {};
      for (const { name, value } of this.attributes) raw[name] = value;
      this.#raw = raw;
      return raw;
    }

    disconnectedCallback() {
      this.#abort?.abort();
      this.#abort = null;
      release(this.#cleanup);
      this.#cleanup = null;
    }
  }

  defineProps(Light, def.propDefs, def.propAttrs);
  defineState(Light, def.stateDefs, (element) => element.schedule());
  if (def.formAssociated) defineFormMembers(Light, def);
  defineMembers(Light, def.members, def.tag);
  customElements.define(def.tag, Light);
}

function hasMembers(def) {
  return Object.keys(def.members ?? {}).length > 0;
}

/** State counts as behavior: its accessors are the only way to change it. */
function hasState(def) {
  return Object.keys(def.stateDefs ?? {}).length > 0;
}

/**
 * A `<script>` block may end by returning a function. That function runs when
 * the element leaves the document. Use it for cleanup that has no signal of its
 * own.
 * Listeners do not need it: they get `signal` as the third argument.
 *
 * It is a promise because the block is compiled to an async function, so a
 * top-level `await` works inside it.
 */
function release(cleanup) {
  Promise.resolve(cleanup).then((fn) => {
    if (typeof fn === 'function') fn();
  });
}

/**
 * Form association, for an element that opted in with `export const
 * formAssociated = true`.
 *
 * A custom element in a `<form>` sends nothing by default, because the browser
 * has no reason to think it is a control. The platform's answer is a static flag,
 * `attachInternals()` for the handle, and `setFormValue` to say what would be
 * submitted.
 *
 * The value comes from a `value` prop, serialized exactly the way its attribute
 * is, so what is submitted is what the DOM says. A form-associated element with
 * no `value` prop can still report validity, so this reports nothing rather than
 * complaining.
 */
function formValueOf(def, element) {
  if (!('value' in (def.propDefs ?? {}))) return undefined;

  const value = element.value;
  if (value === null || value === undefined || value === false) return null;
  if (typeof value === 'string') return value;
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/** The callbacks a form calls on its controls. Identical for both kinds. */
function defineFormMembers(Class, def) {
  Object.defineProperties(Class.prototype, {
    /**
     * Reset puts the prop back to the default its `<script properties>` block
     * declared. That is the same thing `value` returns when the attribute is
     * absent, so removing it is the whole job.
     */
    formResetCallback: {
      value() {
        if ('value' in (def.propDefs ?? {})) this.removeAttribute(attrName('value'));
        this.reportFormValue?.();
      },
      configurable: true,
    },

    /** A fieldset or form went disabled. Mirrored to an attribute if declared. */
    formDisabledCallback: {
      value(disabled) {
        if (!('disabled' in (def.propDefs ?? {}))) return;
        if (disabled) this.setAttribute('disabled', '');
        else this.removeAttribute('disabled');
      },
      configurable: true,
    },

    /**
     * The browser restoring a value after a back-navigation or a crash. Same
     * shape as a submit, so writing the attribute is enough.
     */
    formStateRestoreCallback: {
      value(state) {
        if (!('value' in (def.propDefs ?? {}))) return;
        if (typeof state === 'string') this.setAttribute(attrName('value'), state);
        this.reportFormValue?.();
      },
      configurable: true,
    },
  });
}

export function defineComponent(def, init) {
  if (typeof customElements === 'undefined') return;
  if (customElements.get(def.tag)) return;

  class Component extends HTMLElement {
    static observedAttributes = Object.keys(def.propDefs ?? {}).map(attrName);
    // The platform's own switch. Without it a `<form>` has no reason to think
    // this element is a control, and nothing it holds is ever submitted.
    static formAssociated = def.formAssociated === true;

    #internals = null;
    #ready = false;
    #cleanup = null;
    #abort = null;
    #bindings = null;
    #bound = false;
    #raw = null;
    #was = null;
    #pending = null;
    #settle = null;

    constructor() {
      super();
      // In the constructor, which is where it belongs and where it can only
      // happen once. For a server-rendered element that is upgrade time.
      if (def.formAssociated) this.#internals = this.attachInternals();
    }

    /** What this element would submit, if it is a control. */
    reportFormValue() {
      if (!this.#internals) return;
      const value = formValueOf(def, this);
      if (value !== undefined) this.#internals.setFormValue(value);
    }

    /** For `setValidity` and the rest. The same handle the platform hands out. */
    get internals() {
      return this.#internals;
    }

    /**
     * Resolves once the render for the changes made so far has happened.
     * Reading it when nothing is pending is not an error. It is already done.
     */
    get updateComplete() {
      return this.#pending ?? Promise.resolve();
    }

    /**
     * Renders are collected into one microtask, so `a = 1; b = 2` is one render
     * and not two. Setting a prop still writes its attribute right away. Only the
     * rendering waits.
     */
    schedule() {
      if (this.#pending) return;
      this.#pending = new Promise((resolve) => {
        this.#settle = resolve;
      });
      queueMicrotask(() => {
        const settle = this.#settle;
        this.#pending = null;
        this.#settle = null;
        if (this.#ready) this.#apply();
        settle();
      });
    }

    connectedCallback() {
      if (!this.shadowRoot) {
        this.attachShadow({ mode: 'open' });
        this.#paint();
      } else if (!this.#bound) {
        // Server-rendered: the markup is already right, so this only has to
        // find the nodes each expression owns. Once only. Moving an element in
        // the document reconnects it, and binding a second time would split an
        // already split text node down the middle.
        this.#adopt();
      }
      // Runs on every connect, not just the first: moving an element in the DOM
      // disconnects and reconnects it, and behaviour that was torn down on the
      // way out has to come back on the way in.
      this.#ready = true;
      this.#abort = new AbortController();
      this.#cleanup = init?.(this, this.shadowRoot, this.#abort.signal, this.#internals);
      this.reportFormValue();
      this.updated?.();
    }

    disconnectedCallback() {
      // Every listener that was passed this signal is now removed, without the
      // block having said anything about removing it.
      this.#abort?.abort();
      this.#abort = null;
      release(this.#cleanup);
      this.#cleanup = null;
    }

    attributeChangedCallback() {
      // Before the render, and not only when ready: a form can be submitted
      // between an attribute change and the microtask that repaints, and what it
      // submits should be what the attribute already says.
      this.reportFormValue();
      if (this.#ready) this.schedule();
    }

    #apply() {
      const prev = this.#raw;
      const prevState = this.#was;
      const raw = this.#snapshot();
      const state = stateOf(this, def.stateDefs);

      // Structure the compiler could not bind is the only reason to rebuild.
      // Everything else is a write to a node that already exists.
      if (
        this.#bindings &&
        prev &&
        !volatileChanged(def.volatile, raw, prev, state, prevState ?? state)
      ) {
        if (def.update(this.#bindings, this.#data(raw))) {
          this.updated?.();
          return;
        }
      }
      this.#paint();
      this.updated?.();
    }

    /** What the template sees: state first, so a prop of the same name cannot
     *  be hidden by one. The compiler rejects that clash anyway. */
    #data(raw) {
      this.#was = { ...stateOf(this, def.stateDefs) };
      return { ...this.#was, ...def.coerce(raw) };
    }

    #snapshot() {
      const raw = {};
      for (const { name, value } of this.attributes) raw[name] = value;
      this.#raw = raw;
      return raw;
    }

    #adopt() {
      const raw = this.#snapshot();
      this.#bindings = def.bind ? def.bind(this.shadowRoot, this.#data(raw)) : null;
      this.#bound = true;
    }

    #paint() {
      const raw = this.#snapshot();
      const data = this.#data(raw);
      const markup = (def.css ? `<style>${def.css}</style>` : '') + def.render(data);

      // innerHTML does NOT process nested shadow root templates. Anything with
      // a child component would end up with inert <template> nodes in the DOM.
      if (this.shadowRoot.setHTMLUnsafe) this.shadowRoot.setHTMLUnsafe(markup);
      else this.shadowRoot.innerHTML = markup;

      // The nodes the old bindings pointed at are gone.
      this.#bindings = def.bind ? def.bind(this.shadowRoot, data) : null;
      this.#bound = true;
    }
  }

  defineProps(Component, def.propDefs, def.propAttrs);
  defineState(Component, def.stateDefs, (element) => element.schedule());
  if (def.formAssociated) defineFormMembers(Component, def);
  defineMembers(Component, def.members, def.tag);
  customElements.define(def.tag, Component);
}
