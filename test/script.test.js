import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ScriptError,
  assertModule,
  assertNoCollisions,
  bindDefaultExport,
  toFunctionBody,
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

// ---- client blocks --------------------------------------------------------

test('client imports are hoisted and the rest becomes a function body', () => {
  const { imports, body } = toFunctionBody([at(`import x from 'x';\nhost.append(x);`)], 'x');
  assert.equal(imports, `import x from 'x';`);
  assert.match(body, /host\.append\(x\);/);
  assert.doesNotMatch(body, /import x/);
});

test('multi-line imports are hoisted whole', () => {
  const source = `import {\n  a,\n  b,\n} from 'x';\nuse(a, b);`;
  const { imports, body } = toFunctionBody([at(source)], 'x');
  assert.match(imports, /import \{\n {2}a,\n {2}b,\n\} from 'x';/);
  assert.match(body, /use\(a, b\);/);
});

test('hoisting preserves line and column positions', () => {
  const source = `import x from 'x';\nhost.append(x);`;
  const { body } = toFunctionBody([at(source)], 'x');
  const [first, second] = body.split('\n');
  assert.equal(first.trim(), '');
  assert.equal(first.length, `import x from 'x';`.length);
  assert.equal(second, 'host.append(x);');
});

test('dynamic import is not mistaken for a declaration', () => {
  const { imports, body } = toFunctionBody([at(`const m = await import('./x.js');`)], 'x');
  assert.equal(imports, '');
  assert.match(body, /await import\('\.\/x\.js'\)/);
});

test('top-level await is allowed — init is async', () => {
  assert.doesNotThrow(() => toFunctionBody([at('await ready();')], 'x'));
});

test('a client block cannot export', () => {
  assert.throws(() => toFunctionBody([at('export const a = 1;')], 'card.html <script>'), /cannot export/);
});

test('multiple client blocks merge', () => {
  const { imports, body } = toFunctionBody([at(`import a from 'a';\nuse(a);`), at('more();')], 'x');
  assert.equal(imports, `import a from 'a';`);
  assert.match(body, /use\(a\);/);
  assert.match(body, /more\(\);/);
});

// ---- the lifted prototype -------------------------------------------------

test('the lifted export and what it reads leave the function body', () => {
  const source = `const FORMAT = 1;
const other = 2;
export const prototype = { go() { return FORMAT; } };
host.x = other;`;
  const { hoisted, body, lifted } = toFunctionBody([at(source)], 'x', { lift: 'prototype' });

  assert.match(hoisted, /const FORMAT = 1;/);
  assert.match(hoisted, /const __members = \{ go\(\) \{ return FORMAT; \} \};/);
  // `other` is setup's, not the prototype's, so it stays per element.
  assert.doesNotMatch(hoisted, /const other = 2;/);
  assert.match(body, /const other = 2;/);
  assert.match(body, /host\.x = other;/);
  assert.ok(lifted);
});

test('a transitive dependency comes along too', () => {
  const source = `const A = 1;
const B = A + 1;
export const prototype = { go() { return B; } };`;
  const { hoisted } = toFunctionBody([at(source)], 'x', { lift: 'prototype' });
  assert.match(hoisted, /const A = 1;/);
  assert.match(hoisted, /const B = A \+ 1;/);
});

test('lifting preserves line and column positions in what stays behind', () => {
  const { body } = toFunctionBody([at(`export const prototype = {};\nhost.x = 1;`)], 'x', {
    lift: 'prototype',
  });
  const [first, second] = body.split('\n');
  assert.equal(first.trim(), '');
  assert.equal(second, 'host.x = 1;');
});

test('a prototype reaching per-element scope is refused', () => {
  assert.throws(
    () => toFunctionBody([at('export const prototype = { go() { return shadow; } };')], 'x', { lift: 'prototype' }),
    /per element/,
  );
});

test('shadowing is tracked, so a local named signal is not a reach', () => {
  assert.doesNotThrow(() =>
    toFunctionBody([at('export const prototype = { go() { const signal = 1; return signal; } };')], 'x', {
      lift: 'prototype',
    }),
  );
});

test('without a lift option every export is still refused', () => {
  assert.throws(() => toFunctionBody([at('export const prototype = {};')], 'x'), /cannot export/);
});

test('page client entries keep their imports and top-level await', () => {
  const code = assertModule([at(`import a from 'a';\nawait a();`)], 'x');
  assert.match(code, /import a from 'a';/);
  assert.match(code, /await a\(\);/);
});
