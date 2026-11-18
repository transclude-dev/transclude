// What an invariant reads from a case's own files, as opposed to its answers.
//
// The `fragment` attribute marks a fragment in the source, and the render takes
// it off. So the names of a case's fragments are only in the source. A `.md`
// page counts: it is compiled as a page once its converter is done, and the
// markup in it passes through.

import fs from 'node:fs';
import path from 'node:path';
import { parseFragment } from 'parse5';

// What a case holds about itself. Markup in these is expected output, not app.
const NOT_THE_APP = new Set(['expected', 'upstream']);

/**
 * Every literal `id` on an element marked `fragment`, in every page source of
 * the case. An id written with `${}` is left out: its value is known only once
 * the page renders.
 *
 * @param {string} caseDir
 * @returns {Set<string>}
 */
export function fragmentIds(caseDir) {
  const ids = new Set();
  for (const file of sourceFiles(caseDir)) {
    const tree = parseFragment(fs.readFileSync(file, 'utf8'));
    for (const element of elementsOf(tree)) {
      const id = attribute(element, 'id');
      const marked = attribute(element, 'fragment') !== null;
      if (marked && id !== null && !id.includes('${')) ids.add(id);
    }
  }
  return ids;
}

/**
 * Every id a `<transclude src="/route#id">` names. That copy belongs to the
 * other route: `/docs/includes` says the fragment lives there, so the page
 * that includes it does not answer for it.
 *
 * @param {string} caseDir
 * @returns {Set<string>}
 */
export function includedIds(caseDir) {
  const ids = new Set();
  for (const file of sourceFiles(caseDir)) {
    const tree = parseFragment(fs.readFileSync(file, 'utf8'));
    for (const element of elementsOf(tree)) {
      const src = element.tagName === 'transclude' ? attribute(element, 'src') : null;
      const hash = src?.indexOf('#') ?? -1;
      if (hash !== -1) ids.add(src.slice(hash + 1));
    }
  }
  return ids;
}

/** @param {string} dir */
function sourceFiles(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (NOT_THE_APP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(full));
    else if (entry.name.endsWith('.html') || entry.name.endsWith('.md')) found.push(full);
  }
  return found;
}

/**
 * Every element under a node, a template's content included. A template in
 * the source can be a slot's filling, which renders as ordinary markup.
 *
 * @param {any} node
 * @returns {any[]}
 */
function elementsOf(node) {
  const found = [];
  for (const child of node.childNodes ?? []) {
    if (child.tagName) found.push(child);
    found.push(...elementsOf(child));
  }
  if (node.content) found.push(...elementsOf(node.content));
  return found;
}

/**
 * An attribute's value, or `null` when the element does not have it.
 *
 * @param {any} element
 * @param {string} name
 */
export function attribute(element, name) {
  const found = element.attrs.find((attr) => attr.name === name);
  return found ? found.value : null;
}
