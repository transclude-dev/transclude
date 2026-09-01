// The four errors that exist only to move code written against 0.x.
//
// Each one names a spelling this framework used to have and says what it is
// now. They are not refusals in the sense `VERSIONING.md` uses: a refusal
// rejects code that was already not doing what it looked like it did, and these
// reject code that was right once. `VERSIONING.md` says when they go, which is
// the next major and not this one — 1.0 is precisely when somebody upgrades
// from 0.x, so removing the messages there would be the worst timing there is.
//
// Until then each has to keep firing, and two of them had nothing checking they
// did. All four:
//
//   `pages/` -> `routes/`                      test/routes.test.js
//   `partialsDir`, `componentsDir` -> `elementsDir`   test/project.test.js
//   `<script properties|props|state>` -> `<script element>`   here
//   `export const actions` -> a verb export    here
//
// What the message says is not a promise, so these assert that an error is
// raised and that it names the new spelling, not the sentence around it.

import test from 'node:test';
import assert from 'node:assert/strict';

import { compilePage, splitBlocks } from '../src/compiler/index.js';

test('a 0.x element block says which one block it is now', () => {
  // Read as anything else this is a client block, and a page's client block in
  // an element file is code that would never run. The error would still arrive,
  // from further away and about something else.
  for (const attr of ['properties', 'props', 'state']) {
    assert.throws(
      () => splitBlocks(`<script ${attr}>\nexport default {};\n</script>\n<p>x</p>`),
      (error) => {
        assert.match(error.message, /<script element>/);
        return true;
      },
      `<script ${attr}> passed through`,
    );
  }
});

test('a 0.x actions object says handlers are named for their method', () => {
  assert.throws(
    () =>
      compilePage('<script server>\nexport const actions = {};\n</script>\n<p>x</p>', {
        runtime: 'transclude/runtime',
        filename: 'page',
      }),
    (error) => {
      assert.match(error.message, /actions/);
      assert.match(error.message, /POST/);
      return true;
    },
  );
});
