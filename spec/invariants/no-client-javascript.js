// A case that asks for no client JavaScript is sent none.
//
// A case asks when its source has a script the browser runs, or an element
// that exports more than `properties`, or its config sets `watchElements`.
// One that does not ask is checked in every HTML answer it was given: no
// script the browser runs, and no `.js` named in a `src`, an `href` or the
// `Link` header. A data block, such as JSON-LD, is not JavaScript.

import { parse, parseFragment } from 'parse5';
import { askedForJavaScript } from './source.js';
import { attribute, elementsOf } from './tree.js';

export const name = 'no client JavaScript unless asked for';

// The script types a browser runs, the same list `source.js` reads with.
const RUNS = new Set(['', 'module', 'text/javascript', 'application/javascript']);

// A URL that names a script, with or without a query or a hash after it.
const SCRIPT_URL = /\.m?js(?:[?#]|$)/;

/**
 * @param {import('../runner/invariants.js').Context} context
 * @returns {Promise<string[]>}
 */
export async function check({ caseDir, config, exchanges }) {
  if (config.watchElements) return [];
  if (askedForJavaScript(caseDir) !== null) return [];
  const problems = [];
  for (const { method, url, headers, body } of exchanges) {
    if (!headers.get('content-type')?.startsWith('text/html')) continue;
    const link = headers.get('link') ?? '';
    if (/\.m?js\b/.test(link)) problems.push(`${method} ${url}: the Link header names a script: ${link}`);
    const tree = /^\s*<!doctype/i.test(body) ? parse(body) : parseFragment(body);
    for (const element of elementsOf(tree)) problems.push(...shipped(element).map((what) => `${method} ${url}: ${what}`));
  }
  return problems;
}

/**
 * What an element ships that a case with no client JavaScript should not get.
 *
 * @param {any} element
 * @returns {string[]}
 */
function shipped(element) {
  const found = [];
  const type = (attribute(element, 'type') ?? '').toLowerCase();
  if (element.tagName === 'script' && RUNS.has(type)) found.push('a <script> the browser runs');
  for (const name of ['src', 'href']) {
    const value = attribute(element, name);
    if (value !== null && SCRIPT_URL.test(value)) found.push(`<${element.tagName} ${name}="${value}">`);
  }
  return found;
}
