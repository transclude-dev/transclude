// Reading a parse5 tree, the same way for a case's source and for its answers.

/**
 * Every element under a node, a template's content included.
 *
 * @param {any} node
 * @returns {any[]}
 */
export function elementsOf(node) {
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

/**
 * The text inside an element, such as a script's code.
 *
 * @param {any} element
 */
export function textOf(element) {
  return element.childNodes.map((child) => child.value ?? '').join('');
}
