// transclude-env.d.ts has to compile.
//
// It never did. Every context type named `__Cookies` and the file declared it
// nowhere, in every project, from the first `npm run check`. Two flags hid it and
// both are the same flag: a `.d.ts` is the one kind of file `skipLibCheck` skips,
// a jsconfig.json implies that option, and the guard in `bin/check.js` written to
// catch this passed it explicitly. So the check ran and read nothing.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkAlone } from '../src/typecheck.js';

import { emitTypes } from '../src/compiler/types.js';

/** What tsc says about a .d.ts on its own. */
function diagnose(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-types-'));
  const file = path.join(dir, 'transclude-env.d.ts');
  fs.writeFileSync(file, source);

  // The guard itself, not a copy of its options: `checkAlone` is what
  // `bin/check.js` runs over the emitted file, so this test and that guard
  // cannot disagree about what the file is allowed to name.
  return checkAlone(file).map((diagnostic) => diagnostic.message);
}

const page = (fields) => ({ pages: [{ id: 'index', pattern: '/', params: [], ...fields }] });

test('a context naming the cookies type compiles', () => {
  const source = emitTypes(page({ context: '{ url: string; cookies: __Cookies }', type: '{}' }));

  assert.match(source, /type __Cookies =/);
  // `__Cookies` names this one, so declaring only what the body mentioned would
  // be the same bug one level down.
  assert.match(source, /type __CookieOptions =/);
  assert.deepEqual(diagnose(source), []);
});

test('the shape type compiles where a loader can answer with a Response', () => {
  const source = emitTypes(page({ context: '{}', type: '__Shape<{ n: number }>' }));

  assert.match(source, /type __Shape<T> =/);
  assert.deepEqual(diagnose(source), []);
});

test('a type the app declared is carried, not named', () => {
  // A `@typedef` in the app is reachable from the file it was written in and
  // nowhere else, and one written in an .html file has no module at all to be
  // imported from. So the file holds a copy.
  const source = emitTypes({
    ...page({ context: '{}', type: '{ posts: Post[] }' }),
    types: [{ name: 'Post', type: '{ title: string; date: Date }' }],
  });

  assert.match(source, /type Post = \{/);
  assert.deepEqual(diagnose(source), []);
});

test('nothing is declared that nothing names', () => {
  const source = emitTypes(page({ context: '{ url: string }', type: '{}' }));

  assert.doesNotMatch(source, /__Cookies/);
  assert.deepEqual(diagnose(source), []);
});

// ---- elements, layouts and the tag name map --------------------------------

test('an element is emitted with its props, its state and its members', () => {
  const source = emitTypes({
    components: [
      {
        tag: 'boxed-card',
        type: '{ label: string }',
        state: '{ open: boolean }',
        members: '{ toggle(): void }',
        upgrades: true,
      },
    ],
  });

  assert.match(source, /export type BoxedCardProps = \{/);
  assert.match(source, /export type BoxedCardState = \{/);
  assert.match(source, /export type BoxedCardMembers = \{/);
  assert.deepEqual(diagnose(source), []);
});

test('an element declaring neither state nor members gets neither type', () => {
  // Emitting an empty `State` would give a page a name to read that stands for
  // nothing, and reading it would compile.
  const source = emitTypes({ components: [{ tag: 'plain-note', type: '{}', upgrades: true }] });

  assert.doesNotMatch(source, /PlainNoteState/);
  assert.doesNotMatch(source, /PlainNoteMembers/);
  assert.deepEqual(diagnose(source), []);
});

test('the tag name map carries only what an element actually has', () => {
  // `querySelector('boxed-card')` should hand back the props and members the
  // element defines. A light element nothing registers is still an
  // HTMLElement, and claiming accessors it never gets would be a lie tsc
  // repeats to every caller.
  const source = emitTypes({
    components: [{ tag: 'boxed-card', type: '{ label: string }', upgrades: true }],
    partials: [{ tag: 'plain-note', type: '{ text: string }', upgrades: false }],
  });

  assert.match(source, /interface HTMLElementTagNameMap \{/);
  assert.match(source, /"boxed-card": HTMLElement & BoxedCardProps;/);
  assert.match(source, /"plain-note": HTMLElement;/);
  assert.deepEqual(diagnose(source), []);
});

test('an app with no elements declares no tag name map at all', () => {
  const source = emitTypes(page({ context: '{}', type: '{}' }));

  assert.doesNotMatch(source, /HTMLElementTagNameMap/);
  assert.deepEqual(diagnose(source), []);
});

test('a layout gets its context and its data, under its own id', () => {
  const source = emitTypes({
    layouts: [
      { id: 'root', type: '{ site: string }', context: '{ url: string }' },
      { id: 'docs', type: '{ nav: string[] }', context: '{ url: string }' },
    ],
  });

  assert.match(source, /export type RootLayoutContext = \{/);
  assert.match(source, /export type RootLayoutData = \{/);
  assert.match(source, /export type DocsLayoutContext = \{/);
  assert.match(source, /export type DocsLayoutData = \{/);
  assert.deepEqual(diagnose(source), []);
});

test('a layout with no context still compiles', () => {
  // A layout with no `<script server>` has no context to describe. `unknown`
  // is the honest stand-in: it reads, and nothing can be taken off it.
  const source = emitTypes({ layouts: [{ id: 'root', type: '{}' }] });

  assert.match(source, /export type RootLayoutContext = unknown;/);
  assert.deepEqual(diagnose(source), []);
});

test('a page with route params gets a type naming them', () => {
  const source = emitTypes({
    pages: [
      {
        id: 'blog-slug',
        pattern: '/blog/:slug',
        params: ['slug'],
        context: '{ params: BlogSlugParams }',
        type: '{}',
      },
    ],
  });

  assert.match(source, /Route params for `\/blog\/:slug`/);
  assert.match(source, /export type BlogSlugParams = \{ slug: string \};/);
  assert.deepEqual(diagnose(source), []);
});

test('a page with no params gets no params type', () => {
  const source = emitTypes(page({ context: '{}', type: '{}' }));

  assert.doesNotMatch(source, /IndexParams/);
  assert.deepEqual(diagnose(source), []);
});
