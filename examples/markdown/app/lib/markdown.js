// The converter this app hands to transclude. The framework ships no Markdown
// parser, so which one, which extensions and which options are decided here.
//
// `marked` is one choice among several. Swapping it for another is this file.

import { Marked } from 'marked';

/**
 * `${` inside code means `${`.
 *
 * A page is a template, so `${name}` in it reads the loader's data. That is
 * wanted in prose and almost never wanted in a code sample: a shell block is
 * full of `${HOME}` and a JavaScript one is full of template literals. Escaping
 * the two code token types keeps prose interpolating and leaves samples alone.
 *
 * Written here rather than in the framework because it is a judgement about how
 * people write, not a rule about how pages compile. An app that wants a sample
 * to interpolate deletes this.
 */
const literalCode = {
  walkTokens(token) {
    if (token.type === 'code' || token.type === 'codespan') {
      token.text = token.text.replaceAll('${', '\\${');
    }
  },
};

const marked = new Marked(literalCode);

/**
 * @param {string} source what is in the `.md` file
 * @returns {string} HTML for the compiler
 */
export function markdown(source) {
  return /** @type {string} */ (marked.parse(source));
}
