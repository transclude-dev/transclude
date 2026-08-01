// A fragment cut out of a document this framework did not compile.
//
// A page here declares its own regions: `<div id="x" fragment>` compiles to its
// own render function and the same markup serves the region inline and alone.
// Nothing in that path parses HTML, and nothing in this file runs against it.
//
// This is for the other case, a document somebody else wrote, where there is no
// attribute to read and no compiler output to reuse. Extent is worked out from
// what HTML already encodes: heading rank and definition-list structure. Nothing
// else is guessed. An id says what a thing is, not where it ends.

import { parse, serializeOuter } from 'parse5';

/** Inline elements that may be standing in for the thing after them. */
const INLINE = new Set(['a', 'span', 'em', 'i', 'b', 'strong', 'small', 'sub', 'sup']);

/** Content that makes an element worth returning even with no text in it. */
const EMBEDDED = new Set([
  'img', 'svg', 'video', 'audio', 'iframe', 'canvas', 'object', 'picture', 'input',
]);

/** Elements that mean nothing outside a particular parent. */
const CONTEXTUAL = new Set([
  'li', 'dd', 'dt', 'td', 'th', 'tr', 'thead', 'tbody', 'tfoot', 'caption', 'col',
  'colgroup', 'option', 'optgroup', 'figcaption', 'legend', 'summary', 'source',
  'track', 'param',
]);

const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

// ---- node access -----------------------------------------------------------
// Everything that touches a parse5 node is here, so a second tree shape is a
// change to this block rather than to the rules below it.

const isElement = (node) => typeof node.tagName === 'string';
const tagOf = (node) => node.tagName ?? null;
const attrOf = (node, name) => node.attrs?.find((a) => a.name === name)?.value ?? null;

/**
 * A `<template>`'s children live on `.content`, not `childNodes`, and they are
 * inert: nothing in there is rendered. A fragment URL that returned template
 * content would return something the source document never showed, so this does
 * not descend into one and an id inside a template is not addressable.
 */
const kidsOf = (node) => (tagOf(node) === 'template' ? [] : (node.childNodes ?? []));

const rankOf = (node) => (HEADINGS.has(tagOf(node)) ? Number(tagOf(node)[1]) : null);

function textOf(node) {
  if (node.nodeName === '#text') return node.value ?? '';
  let out = '';
  for (const child of kidsOf(node)) out += textOf(child);
  return out;
}

function hasEmbedded(node) {
  if (EMBEDDED.has(tagOf(node))) return true;
  return kidsOf(node).some(hasEmbedded);
}

/** Every element in document order, template content excluded. */
function* walk(node) {
  for (const child of kidsOf(node)) {
    if (isElement(child)) yield child;
    yield* walk(child);
  }
}

// ---- slugs -----------------------------------------------------------------

/**
 * A heading's text as an id, the way GitHub and MDN write one.
 *
 * Unicode letters and numbers are kept rather than folded to ASCII: a document
 * whose headings are not in English should still be addressable in its own
 * script.
 */
export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Every id the document offers, explicit and generated, worked out in one pass.
 *
 * The whole table is built before any single fragment is resolved. Computing a
 * slug on demand would make the suffix a heading gets depend on which fragment
 * was asked for, so the same URL would mean different things on different
 * requests.
 */
export function readDocument(html) {
  return indexDocument(parse(html));
}

/**
 * The same table, over a tree that has already been parsed.
 *
 * The proxy sanitizes and rewrites a foreign document before indexing it, and
 * indexing first would leave the table naming elements the cleaning removed.
 */
export function indexDocument(root) {
  const ids = new Map();
  const duplicates = new Set();
  const headings = [];
  const order = [];
  const position = new Map();

  for (const element of walk(root)) {
    position.set(element, position.size);
    const id = attrOf(element, 'id');
    if (id) {
      if (ids.has(id)) duplicates.add(id);
      else {
        ids.set(id, element);
        order.push({ id, element, implicit: false });
      }
    }
    if (HEADINGS.has(tagOf(element))) headings.push(element);
  }

  // Explicit ids win outright, so they are all reserved before the first slug
  // is handed out.
  const taken = new Set(ids.keys());
  const slugs = new Map();

  for (const heading of headings) {
    if (attrOf(heading, 'id')) continue;

    const base = slugify(textOf(heading));
    if (!base) continue;

    let slug = base;
    for (let n = 1; taken.has(slug); n += 1) slug = `${base}-${n}`;

    taken.add(slug);
    slugs.set(slug, heading);
    order.push({ id: slug, element: heading, implicit: true });
  }

  // `order` gathered explicit ids in document order and then appended the
  // generated ones, so it is sorted once here rather than interleaved above.
  order.sort((a, b) => position.get(a.element) - position.get(b.element));

  return { root, ids, slugs, duplicates, order };
}

// ---- extent ----------------------------------------------------------------

const siblingsOf = (node) => (node.parentNode ? kidsOf(node.parentNode) : []);

/**
 * The rank a sibling terminates a run at, or null if it does not terminate one.
 *
 * An `<hgroup>` counts as the heading it holds, so a run started before one
 * stops at it the way it would stop at a bare heading.
 */
function terminatingRank(node) {
  if (!isElement(node)) return null;
  if (HEADINGS.has(tagOf(node))) return rankOf(node);
  if (tagOf(node) !== 'hgroup') return null;

  const ranks = [...walk(node)].filter((n) => HEADINGS.has(tagOf(n))).map(rankOf);
  return ranks.length ? Math.min(...ranks) : null;
}

/** A heading and everything under it, up to the next heading of its rank or above. */
function headingRun(heading) {
  // An `<hgroup>` is the unit: the run starts at the group's own position among
  // its siblings, not at the heading's position inside the group.
  const start = tagOf(heading.parentNode) === 'hgroup' ? heading.parentNode : heading;
  const rank = rankOf(heading);

  const siblings = siblingsOf(start);
  const from = siblings.indexOf(start);
  const nodes = [start];

  for (const node of siblings.slice(from + 1)) {
    const stop = terminatingRank(node);
    if (stop !== null && stop <= rank) break;
    nodes.push(node);
  }
  return nodes;
}

/** A `<dt>` and its definitions, up to the next term. */
function termRun(dt) {
  const siblings = siblingsOf(dt);
  const nodes = [dt];

  for (const node of siblings.slice(siblings.indexOf(dt) + 1)) {
    if (isElement(node) && tagOf(node) === 'dt') break;
    nodes.push(node);
  }
  return nodes;
}

/**
 * An empty inline element is a bookmark for what follows it, not the thing
 * being addressed. `<a id="install"></a><h2>Installing</h2>` is everywhere in
 * documents old enough to predate ids on headings.
 *
 * One hop only. Chaining would walk past real content whenever two bookmarks
 * sit together.
 */
function throughBookmark(element) {
  if (!INLINE.has(tagOf(element))) return element;
  if (textOf(element).trim() !== '') return element;
  if (hasEmbedded(element)) return element;

  const siblings = siblingsOf(element);
  const after = siblings.slice(siblings.indexOf(element) + 1).find(isElement);
  return after ?? element;
}

function ancestorsOf(element) {
  const chain = [];
  for (let node = element.parentNode; node && isElement(node); node = node.parentNode) {
    if (tagOf(node) === 'html' || tagOf(node) === 'body') break;
    chain.unshift(tagOf(node));
  }
  return chain;
}

// ---- what a caller gets ----------------------------------------------------

/**
 * The fragment named by `id`, or null if the document does not offer one.
 *
 * `nodes` is a list, not one element. A heading run is several siblings, and
 * wrapping them in a container would mean the fetched fragment did not match
 * what the source document renders in that place.
 */
export function resolveFragment(input, id) {
  const doc = typeof input === 'string' ? readDocument(input) : input;
  const diagnostics = [];

  const explicit = doc.ids.get(id);
  const found = explicit ?? doc.slugs.get(id);
  if (!found) return null;

  if (doc.duplicates.has(id)) {
    diagnostics.push({
      code: 'duplicate-id',
      message: `more than one element has id "${id}"; the first in document order was taken`,
    });
  }

  // A generated slug names its heading, which is already the thing to return.
  const element = explicit ? throughBookmark(found) : found;
  if (element !== found) {
    diagnostics.push({
      code: 'bookmark',
      message: `"${id}" is an empty <${tagOf(found)}>, so <${tagOf(element)}> after it was taken`,
    });
  }

  let nodes;
  let kind;

  if (HEADINGS.has(tagOf(element))) {
    nodes = headingRun(element);
    kind = 'heading-run';
  } else if (tagOf(element) === 'dt') {
    nodes = termRun(element);
    kind = 'dt-run';
  } else {
    nodes = [element];
    kind = 'element';
  }

  const outer = tagOf(nodes[0]);
  const standalone = !CONTEXTUAL.has(outer);
  const ancestors = standalone ? [] : ancestorsOf(nodes[0]);

  if (!standalone) {
    diagnostics.push({
      code: 'not-standalone',
      message:
        `<${outer}> means nothing on its own; it needs ` +
        `${ancestors.length ? ancestors.join(' > ') : 'a parent'} around it`,
      ancestors,
    });
  }

  return {
    id,
    implicit: !explicit,
    nodes,
    html: nodes.map((node) => serializeOuter(node)).join(''),
    kind,
    standalone,
    diagnostics,
  };
}

/**
 * Every fragment the document offers, in document order.
 *
 * This is the claim that the rules work on markup nobody wrote for us: run it
 * over a page and the result should read like that page's outline.
 */
export function listFragments(input) {
  const doc = typeof input === 'string' ? readDocument(input) : input;

  return doc.order.map(({ id, element, implicit }) => {
    const tag = tagOf(element);
    const rank = rankOf(element);
    return {
      id,
      implicit,
      tag,
      rank,
      kind: rank ? 'heading-run' : tag === 'dt' ? 'dt-run' : 'element',
      text: textOf(element).replace(/\s+/g, ' ').trim().slice(0, 120),
    };
  });
}
