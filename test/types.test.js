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
import ts from 'typescript';

import { emitTypes } from '../src/compiler/types.js';

/** What tsc says about a .d.ts on its own. */
function diagnose(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-types-'));
  const file = path.join(dir, 'transclude-env.d.ts');
  fs.writeFileSync(file, source);

  // The same options `bin/check.js` uses, so this test and that guard agree
  // about what the file is allowed to name.
  const program = ts.createProgram([file], {
    noEmit: true,
    skipLibCheck: false,
    types: [],
    target: ts.ScriptTarget.ESNext,
    lib: ['lib.esnext.d.ts', 'lib.dom.d.ts'],
  });

  return [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()].map((d) =>
    ts.flattenDiagnosticMessageText(d.messageText, ' '),
  );
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
