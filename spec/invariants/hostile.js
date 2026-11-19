// Strings made to break markup, for the checks that send generated values.
//
// Two characters are left out: NUL and the carriage return. An HTML parser
// changes both before any element is read, whatever the server wrote, so they
// test the parser and not the framework.

import fc from 'fast-check';

// The pieces that break markup when they are not escaped, and some that look
// escaped already. fast-check strings them together with any other character.
const PIECES = [
  '<', '>', '&', '"', "'", '`', '=', '/', ' ', '\n', '\t',
  '<script>', '</p>', '</pre>', '</textarea>', '<!--', '-->', '<![CDATA[',
  '&amp;', '&lt;', '&#60;', '&#x3c;', '&quot', '${', '}',
  ' onclick=alert(1) ', '"><b>', "'><b>", ' ', ' ', 'é', '😀',
];

const character = fc.string({ unit: 'grapheme', minLength: 1, maxLength: 1 });

export const hostile = fc
  .string({ unit: fc.oneof(fc.constantFrom(...PIECES), character), maxLength: 12 })
  .filter((value) => !/[\0\r]/.test(value));
