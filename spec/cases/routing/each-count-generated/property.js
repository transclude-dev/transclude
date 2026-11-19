// `each` over n items renders n instances, in order.
//
// The page loops over rows, and over the cells of each row inside that. Each
// instance prints its index, so a list that comes back short, long or out of
// order shows. Empty lists and lists of one are asked first, every run.

import fc from 'fast-check';
import { parse } from 'parse5';
import { attribute, elementsOf, textOf } from '../../../invariants/tree.js';

export const name = 'loop count';

const RUNS = 100;

const cell = fc.string({ maxLength: 3 });
const rows = fc.array(fc.array(cell, { maxLength: 5 }), { maxLength: 8 });

// Zero rows, one empty row, one row of one, and n rows of 0, 1 and n.
const EXAMPLES = [[[]], [[[]]], [[['a']]], [[['a', 'b', 'c'], [], ['d']]]];

/**
 * @param {import('../../../runner/invariants.js').Context} context
 * @returns {Promise<string[]>}
 */
export async function check({ ask }) {
  const rendersEach = fc.asyncProperty(rows, async (sent) => {
    const query = new URLSearchParams({ rows: JSON.stringify(sent) });
    const answer = await ask('GET', `/?${query}`, {});
    const problems = differences(elementsOf(parse(answer.body)), sent);
    if (problems.length) throw new Error(problems.join('\n'));
  });
  const run = await fc.check(rendersEach, { numRuns: RUNS, examples: EXAMPLES });
  if (!run.failed) return [];
  const [sent] = run.counterexample;
  return [`rows ${JSON.stringify(sent)} (seed ${run.seed}):\n${run.errorInstance?.message ?? run.error}`];
}

/**
 * @param {any[]} elements
 * @param {string[][]} sent
 */
function differences(elements, sent) {
  const rendered = elements.filter((el) => el.tagName === 'li');
  if (rendered.length !== sent.length) return [`${sent.length} rows sent, ${rendered.length} rendered`];
  const problems = [];
  sent.forEach((row, r) => {
    const li = rendered[r];
    if (attribute(li, 'data-row') !== String(r)) problems.push(`row ${r} printed index ${attribute(li, 'data-row')}`);
    const cells = elementsOf(li).filter((el) => el.tagName === 'span');
    if (cells.length !== row.length) return problems.push(`row ${r}: ${row.length} cells sent, ${cells.length} rendered`);
    row.forEach((text, c) => {
      if (attribute(cells[c], 'data-cell') !== String(c)) problems.push(`row ${r} cell ${c} printed index ${attribute(cells[c], 'data-cell')}`);
      if (textOf(cells[c]) !== text) problems.push(`row ${r} cell ${c}: ${JSON.stringify(textOf(cells[c]))}, expected ${JSON.stringify(text)}`);
    });
  });
  return problems;
}
