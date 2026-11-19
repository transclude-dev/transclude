// Generated strings through `${}` come out as the same text.
//
// The page writes one value into text, a `<pre>`, a `<textarea>` and six kinds
// of attribute value, and a list of values through `each`. A hostile value must
// add no element and no attribute, and each place must read back as the value
// itself. The same page sent a plain `x` in each value gives the shape to
// compare with.
//
// Two characters are left out of the values: NUL and the carriage return. An
// HTML parser changes both before any element is read, whatever the server
// wrote, so they test the parser and not the escape.

import fc from 'fast-check';
import { parse } from 'parse5';
import { lineDiff } from '../../../runner/compare.js';
import { attribute, elementsOf, textOf } from '../../../invariants/tree.js';

export const name = 'escaping';

const RUNS = 300;

// The pieces that break markup when they are not escaped, and some that look
// escaped already. fast-check strings them together with any other character.
const PIECES = [
  '<', '>', '&', '"', "'", '`', '=', '/', ' ', '\n', '\t',
  '<script>', '</p>', '</pre>', '</textarea>', '<!--', '-->', '<![CDATA[',
  '&amp;', '&lt;', '&#60;', '&#x3c;', '&quot', '${', '}',
  ' onclick=alert(1) ', '"><b>', "'><b>", ' ', ' ', 'é', '😀',
];

const character = fc.string({ unit: 'grapheme', minLength: 1, maxLength: 1 });
const hostile = fc
  .string({ unit: fc.oneof(fc.constantFrom(...PIECES), character), maxLength: 12 })
  .filter((value) => !/[\0\r]/.test(value));

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
