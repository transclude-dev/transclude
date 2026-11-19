// Generated strings through `${}` come out as the same text.
//
// The page writes one value into text, a `<pre>`, a `<textarea>` and six kinds
// of attribute value, and a list of values through `each`. A hostile value must
// add no element and no attribute, and each place must read back as the value
// itself. The same page sent a plain `x` in each value gives the shape to
// compare with.
//
// The values come from `spec/invariants/hostile.js`, which says what it leaves
// out.

import fc from 'fast-check';
import { parse } from 'parse5';
import { lineDiff } from '../../../runner/compare.js';
import { hostile } from '../../../invariants/hostile.js';
import { attribute, elementsOf, textOf } from '../../../invariants/tree.js';

export const name = 'escaping';

const RUNS = 300;

const input = fc.record({ value: hostile, items: fc.array(hostile, { maxLength: 4 }) });

/**
 * @param {import('../../../runner/invariants.js').Context} context
 * @returns {Promise<string[]>}
 */
export async function check({ ask }) {
  const comesOutAsText = fc.asyncProperty(input, async ({ value, items }) => {
    const plain = await render(ask, 'x', items.map(() => 'x'));
    const sent = await render(ask, value, items);
    const problems = [...differentShape(plain, sent), ...differentText(sent, value, items)];
    if (problems.length) throw new Error(problems.join('\n'));
  });
  const run = await fc.check(comesOutAsText, { numRuns: RUNS });
  if (!run.failed) return [];
  const [sent] = run.counterexample;
  return [`${JSON.stringify(sent)} (seed ${run.seed}):\n${run.errorInstance?.message ?? run.error}`];
}

/**
 * The page's elements, parsed the way a browser parses them.
 *
 * @param {import('../../../runner/invariants.js').Context['ask']} ask
 * @param {string} value
 * @param {string[]} items
 */
async function render(ask, value, items) {
  const query = new URLSearchParams({ value, items: JSON.stringify(items) });
  const answer = await ask('GET', `/?${query}`, {});
  return elementsOf(parse(answer.body));
}

/**
 * Each element's tag and attribute names, in order. A value that opened an
 * element or an attribute shows here.
 */
function differentShape(plain, sent) {
  const shape = (elements) => elements.map((el) => `<${[el.tagName, ...el.attrs.map((a) => a.name)].join(' ')}>`);
  const want = shape(plain).join('\n');
  const got = shape(sent).join('\n');
  return want === got ? [] : [`the elements changed:\n${lineDiff(want, got)}`];
}

/** Each place the page wrote the value, read back. */
function differentText(elements, value, items) {
  const byId = (id) => elements.find((el) => attribute(el, 'id') === id);
  const places = [
    ['text', textOf(byId('text')), value],
    ['between', textOf(byId('between')), `before ${value} after`],
    ['pre', textOf(byId('pre')), value],
    ['field', textOf(byId('field')), value],
    ['whole', attribute(byId('whole'), 'value'), value],
    ['part', attribute(byId('part'), 'title'), `before ${value} after`],
    ['twice', attribute(byId('twice'), 'title'), value + value],
    ['single', attribute(byId('single'), 'title'), value],
    ['bare', attribute(byId('bare'), 'title'), value],
  ];
  const listed = elements.filter((el) => el.tagName === 'li');
  items.forEach((item, i) => {
    places.push([`item ${i} text`, listed[i] && textOf(listed[i]), item]);
    places.push([`item ${i} title`, listed[i] && attribute(listed[i], 'title'), item]);
  });
  return places
    .filter(([, got, want]) => got !== want)
    .map(([place, got, want]) => `${place}: ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
}
