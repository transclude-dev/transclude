// The board as it reaches a browser.
//
// `@transclude/core/production` builds the same app `npm start` serves, from
// `dist`. Asking it for `/` returns the bytes a browser gets, so these read the
// real markup rather than a fixture.
//
// It needs a build, and skips without one rather than failing.
//
// What a browser does with those bytes is CSS, and Node models none of it. So
// the checks here are about the two halves agreeing: every colour in the server
// block has the rules the mechanic needs, every label points at a radio that
// exists, and nothing in the page is a script.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const built = fs.existsSync(path.join(root, 'dist', 'routes.json'));
const describe = built ? test : test.skip;

const { app } = built ? await import('@transclude/core/production') : { app: null };

const page = built ? await app.request('http://localhost/').then((res) => res.text()) : '';

/** The colours the tray offers, read back out of the markup. */
const inks = [...page.matchAll(/id="ink-([a-z]+)"/g)].map(([, id]) => id).filter((id) => id !== 'off');

describe('every hole is a radio group of nine', () => {
  const holes = page.match(/<div class="hole"/g) ?? [];
  const groups = new Set([...page.matchAll(/name="(p\d+)"/g)].map(([, name]) => name));

  assert.equal(holes.length, groups.size, 'one group per hole');
  assert.equal(
    (page.match(/name="p\d+"/g) ?? []).length,
    holes.length * (inks.length + 1),
    'a radio per colour, plus the empty one',
  );
});

describe('a hole starts empty, and only the empty radio says so', () => {
  const checked = [...page.matchAll(/<input[^>]*\bchecked\b[^>]*>/g)].map(([tag]) => tag);

  assert.equal(checked.length, (page.match(/<div class="hole"/g) ?? []).length);
  for (const tag of checked) assert.match(tag, /class="off"/);
});

describe('no swatch is checked, which is what puts red in hand', () => {
  // The CSS reads `.brite:not(:has(.pick:checked))` for both the first paint and
  // the state after a reset. A `checked` on any swatch here breaks the second
  // one quietly: the board would empty and keep whatever colour was in hand.
  const tray = page.slice(page.indexOf('<fieldset'), page.indexOf('</fieldset>'));

  assert.doesNotMatch(tray, /\bchecked\b/);
});

describe('every label points at a radio that exists', () => {
  const ids = [...page.matchAll(/\sid="([^"]+)"/g)].map(([, id]) => id);
  const targets = [...page.matchAll(/\sfor="([^"]+)"/g)].map(([, id]) => id);

  assert.equal(new Set(ids).size, ids.length, 'no id is used twice');
  for (const target of targets) assert.ok(ids.includes(target), `nothing has id="${target}"`);
});

describe('the style block and the colour list agree', () => {
  // Adding a colour to INKS means adding four rules. Forgetting one of them is
  // silent: the swatch appears and the peg it places is invisible.
  assert.ok(inks.length > 1, 'there are colours to check');

  for (const ink of inks) {
    assert.match(page, new RegExp(`--${ink}:\\s*#`), `${ink} has no colour`);
    assert.match(page, new RegExp(`\\.hole:has\\(input\\.${ink}:checked\\)`), `${ink} renders nothing`);
    assert.match(page, new RegExp(`#ink-${ink}:checked\\) \\.hole > label\\.${ink}`), `${ink} is never in hand`);
    assert.match(page, new RegExp(`\\.swatch\\.${ink} \\{`), `${ink} has no swatch`);
  }
});

describe('the tray comes before the board, so the keyboard reaches it first', () => {
  // Two hundred holes are two hundred tab stops. The tray is placed back under
  // the board by grid, and a refactor that reorders the markup loses this.
  assert.ok(page.indexOf('<fieldset') < page.indexOf('class="board"'));
});

describe('clearing the board is a reset button, not a handler', () => {
  assert.match(page, /<input type="reset"/);
});

describe('the page ships no JavaScript', () => {
  assert.doesNotMatch(page, /<script/, 'a form-only app has nothing to send');
  assert.doesNotMatch(page, /\son[a-z]+="/, 'and no inline handlers either');
});

describe('the board reads no request, so the build wrote it to a file', () => {
  assert.ok(fs.existsSync(path.join(root, 'dist', 'static', 'index.html')));
});
