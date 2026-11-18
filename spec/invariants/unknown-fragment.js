// A name that is not a fragment of the page answers 404.
//
// For each page a case was answered, `?fragment=<name>` is asked with names
// the case does not mark. Three kinds: an id the page has without the
// `fragment` attribute, a name every object inherits, and a generated string.
// The first two are where a lookup goes wrong. The third finds what nobody
// thought of.

import fc from 'fast-check';
import { parse } from 'parse5';
import { withFragment } from './fragment-equivalence.js';
import { attribute, fragmentIds } from './source.js';

export const name = 'unknown fragment';

// Names a plain object answers for without holding them.
const INHERITED = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'prototype'];

// Generated names per page. Enough to try odd characters, few enough that the
// corpus still runs in seconds.
const RUNS = 20;

/**
 * @param {import('../runner/invariants.js').Context} context
 * @returns {Promise<string[]>}
 */
export async function check({ caseDir, fragmentParam, exchanges, ask }) {
  if (fragmentParam === null) return [];
  const marked = fragmentIds(caseDir);
  const pages = exchanges.filter((answer) => isPage(answer));
  const problems = [];
  for (const page of pages) {
    const named = [...idsIn(parse(page.body)), ...INHERITED].filter((id) => !marked.has(id));
    for (const id of named) {
      const url = withFragment(page.url, fragmentParam, id);
      const { status } = await ask('GET', url, page.init);
      if (status !== 404) problems.push(`GET ${url}: expected 404, got ${status}`);
    }
    problems.push(...(await generated(page, fragmentParam, marked, ask)));
  }
  return problems;
}

/**
 * Generated names, asked until one answers something other than 404. fast-check
 * then shrinks it to the smallest name that still does, and says which seed
 * replays the run.
 */
async function generated(page, param, marked, ask) {
  const unmarked = fc.string({ minLength: 1 }).filter((id) => !marked.has(id));
  const answers404 = fc.asyncProperty(unmarked, async (id) => {
    const { status } = await ask('GET', withFragment(page.url, param, id), page.init);
    return status === 404;
  });
  const run = await fc.check(answers404, { numRuns: RUNS });
  if (!run.failed) return [];
  const [id] = run.counterexample;
  return [`GET ${withFragment(page.url, param, id)}: expected 404 (generated, seed ${run.seed})`];
}

/** A whole document answered to a GET. */
function isPage(answer) {
  if (answer.method !== 'GET' || answer.status !== 200) return false;
  if (!answer.headers.get('content-type')?.startsWith('text/html')) return false;
  return /^\s*<!doctype/i.test(answer.body);
}

/**
 * Every id in a document, outside templates.
 *
 * @param {any} node
 * @returns {string[]}
 */
function idsIn(node) {
  const found = [];
  for (const child of node.childNodes ?? []) {
    const id = child.tagName ? attribute(child, 'id') : null;
    if (id) found.push(id);
    found.push(...idsIn(child));
  }
  return found;
}
