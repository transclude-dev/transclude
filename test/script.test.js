import test from 'node:test';
import assert from 'node:assert/strict';

import * as acorn from 'acorn';

import {
  ScriptError,
  assertModule,
  assertNoCollisions,
  bindDefaultExport,
  bindElementModule,
} from '../src/compiler/script.js';

const at = (code, line = 1) => ({ code, line });

// ---- export default rewriting --------------------------------------------

test('rewrites an arrow default export', () => {
  const { code } = bindDefaultExport(at('export default async () => ({ a: 1 });'), '__load', 'x');
  assert.match(code, /^const __load = async \(\) => \(\{ a: 1 \}\);/);
});

test('rewrites a named function default export into an expression', () => {
  const { code } = bindDefaultExport(at('export default function load(ctx) { return ctx; }'), '__load', 'x');
  assert.match(code, /const __load = function load\(ctx\) \{ return ctx; \};/);
  assert.doesNotThrow(() => new Function(`${code}; return __load;`));
});

test('rewrites a class default export', () => {
  const { code } = bindDefaultExport(at('export default class Store {};'), '__x', 'x');
  assert.doesNotThrow(() => new Function(`${code}; return __x;`));
});

test('leaves imports where the author put them', () => {
  const source = `import { db } from './db.js';\nexport default () => db.all();`;
  const { code } = bindDefaultExport(at(source), '__load', 'x');
  assert.match(code, /^import \{ db \} from '\.\/db\.js';/);
});

test('a mention of export default in a comment is not a default export', () => {
  // The old regex rewrote this line and produced a syntax error.
  const source = `// export default () => ({});\nconst noop = 1;`;
  const { code } = bindDefaultExport(at(source), '__load', 'x');
  assert.match(code, /^\/\/ export default/);
  assert.match(code, /const __load = null;/);
});

test('a string containing export default is not a default export', () => {
  const { code } = bindDefaultExport(at(`const hint = "export default {}";`), '__load', 'x');
  assert.match(code, /const __load = null;/);
});

test('no default export yields null', () => {
  const { code } = bindDefaultExport(at('const a = 1;'), '__load', 'x');
  assert.match(code, /const __load = null;/);
});

test('two default exports is a parse error, not a silent first-wins', () => {
  assert.throws(
    () => bindDefaultExport(at('export default 1;\nexport default 2;'), '__x', 'page'),
    /Duplicate export/,
  );
});

test('syntax errors report the line inside the .html file', () => {
  const block = { code: '\nconst a = ;\n', line: 12 };
  assert.throws(() => bindDefaultExport(block, '__x', 'index.html <script server>'), (err) => {
    assert.ok(err instanceof ScriptError);
    assert.match(err.message, /index\.html <script server>/);
    assert.match(err.message, /line 13/);
    return true;
  });
});

// ---- named exports --------------------------------------------------------

test('named exports are reported and left in place', () => {
  const { code, exports } = bindDefaultExport(
    at('export const revalidate = 60;\nexport default () => ({});'),
    '__load',
    'x',
  );
  assert.deepEqual(exports, ['revalidate']);
  assert.match(code, /export const revalidate = 60;/);
});

test('destructured named exports are all reported', () => {
  const { exports } = bindDefaultExport(at('export const { a, b: [c] } = obj;'), '__x', 'x');
  assert.deepEqual(exports.sort(), ['a', 'c']);
});

test('specifier exports are reported under their exported name', () => {
  const { exports } = bindDefaultExport(at('const a = 1;\nexport { a as css };'), '__x', 'x');
  assert.deepEqual(exports, ['css']);
});

test('export * is rejected because its names cannot be checked', () => {
  assert.throws(() => bindDefaultExport(at(`export * from './x.js';`), '__x', 'x'), /export \*/);
});

test('collisions with the generated module are caught by name', () => {
  assert.throws(
    () => assertNoCollisions(['css'], new Set(['css', 'render']), 'index.html <script server>'),
    /already defines/,
  );
  assert.doesNotThrow(() => assertNoCollisions(['revalidate'], new Set(['css']), 'x'));
});

// ---- <script element> ------------------------------------------------------
//
// The block is a module. It is read by name, rebound in place, and everything
// the author wrote that is not one of those names is left exactly where it was.

const element = (code) => bindElementModule(at(code), 'a-a.html <script element>');

test('each reserved export is rebound to what the module calls it', () => {
  const { code } = element(
    'export const properties = { a: 1 };\nexport const state = { b: 2 };\n' +
      'export const prototype = { go() {} };\nexport const attributes = { a: {} };',
  );

  // The padding is the point: the initializer keeps the column it was written at.
  assert.match(code, /const __propDefs = +\{ a: 1 \};/);
  assert.match(code, /const __stateDefs = +\{ b: 2 \};/);
  assert.match(code, /const __members = +\{ go\(\) \{\} \};/);
  assert.match(code, /const __propAttrs = +\{ a: \{\} \};/);
});

test('a rebind moves nothing after it', () => {
  // Padded with spaces, so a line and column in the generated module is the same
  // line and column in the .html file. A stack trace has to land somewhere true.
  const source = 'export const properties = { a: 1 };\nconst after = 2;';
  const { code } = element(source);

  assert.equal(code.split('\n').length, source.split('\n').length);
  assert.equal(code.indexOf('const after'), source.indexOf('const after'));
});

test('the initializer node comes back, for the checks that read its keys', () => {
  const { nodes } = element('export const properties = { a: 1 };\nexport const prototype = {};');

  assert.equal(nodes.properties.type, 'ObjectExpression');
  assert.equal(nodes.prototype.type, 'ObjectExpression');
  assert.equal(nodes.state, null);
});

test('flags are read as literals and blanked out of the code', () => {
  const { code, flags } = element('export const shadow = true;\nexport const formAssociated = false;');

  assert.equal(flags.shadow, true);
  assert.equal(flags.formAssociated, false);
  assert.doesNotMatch(code, /export const/);
});

test('a flag nobody declared is null, which is not the same as false', () => {
  const { flags } = element('export const properties = {};');

  assert.equal(flags.shadow, null);
  assert.equal(flags.formAssociated, null);
});

test('a computed flag is refused, because it decides something about the tag', () => {
  assert.throws(() => element('export const shadow = 1 > 0;'), /must be `true` or `false`/);
});

test('imports stay where the author put them', () => {
  const { code, imports } = element("import { fmt } from './f.js';\nexport const prototype = { at() { return fmt(1); } };");

  assert.match(code, /^import \{ fmt \} from '\.\/f\.js';/);
  assert.equal(imports[0].source, './f.js');
});

test('a helper is left at module scope, because that is where it was written', () => {
  // Nothing is hoisted any more. The block is a module, so the order the author
  // wrote is the order the module has.
  const { code } = element("const LIMIT = 3;\nexport const prototype = { cap() { return LIMIT; } };");

  assert.ok(code.indexOf('const LIMIT') < code.indexOf('const __members'));
});

test('an export the element does not declare is refused', () => {
  assert.throws(() => element('export const other = 1;'), /is not something an element declares/);
  assert.throws(() => element('export function go() {}'), /is not something an element declares/);
});

test('a default export is refused, and the message says what to write', () => {
  assert.throws(() => element('export default { a: 1 };'), /export const properties/);
});

test('the same export twice is refused rather than last-wins', () => {
  assert.throws(
    () => element('export const properties = { a: 1 };\nexport const properties = { b: 2 };'),
    /exported twice|already been declared/,
  );
});

test('a parse error points back into the .html file', () => {
  assert.throws(
    () => bindElementModule({ code: 'export const properties = {', line: 12 }, 'a-a.html <script element>'),
    (error) => error instanceof ScriptError && /line 12/.test(error.message),
  );
});

test('page client entries keep their imports and top-level await', () => {
  const code = assertModule([at(`import a from 'a';\nawait a();`)], 'x');
  assert.match(code, /import a from 'a';/);
  assert.match(code, /await a\(\);/);
});
