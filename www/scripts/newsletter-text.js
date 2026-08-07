// The plain-text half of a newsletter, derived from the HTML rather than
// written twice.
//
// Every mail client takes `text/plain` and some readers prefer it, so an email
// without one is an email that reads as a wall of nothing to them. Writing it by
// hand is a second copy of the same words, and a second copy drifts. This walks
// the markup that is already going out.
//
// It reads a tree rather than a string. A regular expression over HTML is the
// classic wrong answer, and the markup here is tables inside tables, which is
// where it goes wrong soonest.

import { parse } from 'parse5';

/** These carry no words a reader wants, whatever is inside them. */
const SILENT = new Set(['script', 'style', 'head', 'title']);

/** After one of these, the text starts a new line. */
const BLOCK = new Set([
  'p', 'div', 'tr', 'table', 'section', 'article', 'header', 'footer',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ul', 'ol', 'br', 'hr',
]);

const attr = (node, name) => node.attrs?.find((a) => a.name === name)?.value;

/**
 * Whether this element is hidden from a reader, and so from the text too.
 *
 * The preheader is the reason this exists. It is a line of text placed at the
 * top of the markup for the inbox to show beside the subject, hidden from
 * anyone who opens the message. Repeating it as the first line of the plain
 * text would say everything twice.
 */
function hidden(node) {
  if (attr(node, 'hidden') !== undefined) return true;

  const style = attr(node, 'style') ?? '';
  return /display\s*:\s*none|max-height\s*:\s*0|font-size\s*:\s*0/.test(style);
}

/**
 * The words in a tree, as one string per block.
 *
 * @param {object} node a parse5 node
 * @param {string[]} out
 */
function walk(node, out) {
  if (node.nodeName === '#text') {
    out.push(node.value);
    return;
  }

  if (SILENT.has(node.nodeName)) return;
  if (node.attrs && hidden(node)) return;

  // A link reads as its text and then where it goes, because plain text cannot
  // carry the second half any other way. Unless the two are the same, which is
  // how a bare URL is written.
  if (node.nodeName === 'a') {
    const href = attr(node, 'href') ?? '';
    const inner = [];
    for (const child of node.childNodes ?? []) walk(child, inner);
    const label = inner.join('').replace(/\s+/g, ' ').trim();

    out.push(!href || href === label ? label : `${label} (${href})`);
    return;
  }

  for (const child of node.childNodes ?? []) walk(child, out);

  if (BLOCK.has(node.nodeName)) out.push('\n\n');
}

/**
 * The plain-text alternative for an email.
 *
 * @param {string} html the message as it will be sent
 * @returns {string}
 */
export function textFrom(html) {
  const out = [];
  walk(parse(html), out);

  return out
    .join('')
    // A newline inside a block is layout rather than meaning, and the markup
    // here is indented to be read as source.
    .replace(/[ \t]*\n[ \t]*(?!\n)/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}
