// The context a loader is handed, in the three places that have to agree.
//
// `src/app.js` builds it for the built server. `bin/dev.js` builds its own,
// because the dev server is a different program. `src/typecheck.js` writes the
// type from a literal. Nothing links them, so a field added to one is missing
// from the others until somebody notices.
//
// Somebody noticed three times. `ctx.after` shipped in 0.7.0 and was undefined
// in dev, so a form calling it worked in production and threw `after is not a
// function` while you were writing it. `ctx.revalidateTag` had been the same
// since it was added. Before those, `/feed.xml` and `/sitemap.xml` were mounted
// in one and not the other.
//
// This is a text check, and that is the honest description of it. `bin/dev.js`
// starts a server the moment it is imported, so no test can build its context
// and look. What it catches is the failure that keeps happening: a key in one
// list and not another.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/**
 * A file with its comments removed.
 *
 * The prose is the problem. Every file here explains itself, and a sentence
 * with "after," in it satisfied a check for the field `after`. Removing
 * `ctx.after` from the dev server left this test green, which is exactly the
 * failure it exists to catch.
 */
const read = (rel) =>
  fs
    .readFileSync(path.join(root, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * Every field a page loader can read.
 *
 * Adding one means adding it here, and this test then names whichever of the
 * three files has not caught up.
 */
const CONTEXT = [
  'url',
  'params',
  'route',
  'request',
  'fragment',
  'action',
  'response',
  'cookies',
  'absolute',
  'revalidateTag',
  'after',
];

/** `key:` or the `key,` shorthand, which `app.js` uses for `response`. */
const declares = (source, key) =>
  new RegExp(`\\b${key}\\s*:`).test(source) || new RegExp(`\\b${key}\\s*,`).test(source);

test('the built server hands over every field', () => {
  const source = read('src/app.js');
  const missing = CONTEXT.filter((key) => !declares(source, key));

  assert.deepEqual(missing, [], `src/app.js contextFor is missing: ${missing.join(', ')}`);
});

test('the dev server hands over the same fields', () => {
  // The one that has been wrong twice. A loader written against dev is written
  // against this list, and anything absent here is a TypeError in dev and fine
  // in the build, which is the direction nobody checks.
  const source = read('bin/dev.js');
  const missing = CONTEXT.filter((key) => !declares(source, key));

  assert.deepEqual(missing, [], `bin/dev.js contextFor is missing: ${missing.join(', ')}`);
});

test('the generated type names the same fields', () => {
  // `transclude-env.d.ts` is written from this literal. A field missing here
  // type-checks as an error on correct code; a field here that nothing provides
  // type-checks fine and is undefined at runtime.
  const source = read('src/typecheck.js');
  const at = source.indexOf('const contextLiteral');
  assert.notEqual(at, -1, 'contextLiteral moved');

  // To the blank line after it. Slicing to the first `};` stops inside the
  // `params: { … }` type, which is three fields in.
  const end = source.indexOf('\n\n', at);
  const literal = source.slice(at, end === -1 ? undefined : end);
  const missing = CONTEXT.filter((key) => !declares(literal, key));

  assert.deepEqual(missing, [], `contextLiteral is missing: ${missing.join(', ')}`);
});

test('the prerender context refuses rather than omits', () => {
  // The build is the one place a field may legitimately not work, because a
  // file has no request. It still has to be present: absent, a loader fails
  // with `x is not a function`, which names neither the page nor the fix.
  const source = read('src/prerender.js');
  const missing = CONTEXT.filter((key) => !declares(source, key));

  assert.deepEqual(missing, [], `prerenderContext is missing: ${missing.join(', ')}`);
});

test('the type promises nothing the runtime does not provide', () => {
  // The other direction, which the three tests above cannot see: a field in
  // the literal that nothing builds type-checks fine and is undefined at
  // runtime. `ctx.htmlAttrs` sat there for three weeks after the feature it
  // described was removed, and every generated project inherited the promise.
  //
  // A text check, like the rest of this file. The nested names are the keys of
  // the blessed shapes: route's three, response's two, the `${name}` the params
  // type writes per parameter, and the argument names of the function fields.
  const source = read('src/typecheck.js');
  const at = source.indexOf('const contextLiteral');
  const end = source.indexOf('\n\n', at);
  const literal = source.slice(at, end === -1 ? undefined : end);

  const allowed = new Set([
    ...CONTEXT,
    'layout',
    'id', 'pattern', 'path', 'status', 'headers', 'name',
    'tag', 'work',
  ]);
  const phantom = [...literal.matchAll(/(\w+):/g)]
    .map(([, key]) => key)
    .filter((key) => !allowed.has(key));

  assert.deepEqual(phantom, [], `the type names fields nothing provides: ${phantom.join(', ')}`);
});

test('layout is spread in at load time, and the type knows it', () => {
  // The twelfth field. It is not in `contextFor`, because the render adds it
  // per loader: each one reads what the chain above it returned. So the
  // provider is `document.js`, which the three lists above cannot see.
  assert.match(read('src/document.js'), /layout: inherited/);
  assert.match(read('src/typecheck.js'), /layout: \$\{layoutType\}/);
});
