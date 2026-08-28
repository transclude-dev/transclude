// What the server sends, and the one rule the compiler enforces.
//
// The rest of what this example teaches is a browser fact: whether page CSS
// reaches in, and whether a change rebuilds or is written. Nothing in Node
// models a shadow root, so those are checked by hand in a browser and the
// README says what to look for.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const built = fs.existsSync(path.join(root, 'dist', 'routes.json'));
const describe = built ? test : test.skip;

const { app } = built ? await import('@transclude/core/production') : { app: null };
const page = () => app.request('http://localhost/').then((res) => res.text());

describe('a light element is rendered on the server, with no shadow root', async () => {
  const markup = await page();

  assert.match(markup, /<site-note label="Note">/);
  const note = markup.slice(markup.indexOf('<site-note'), markup.indexOf('</site-note>'));
  assert.doesNotMatch(note, /shadowrootmode/, 'light means no boundary in the markup');
});

describe('a shadow element carries a declarative shadow root', async () => {
  const markup = await page();

  assert.match(markup, /<person-card[\s\S]*?shadowrootmode="open"/);
  assert.equal(
    markup.match(/shadowrootmode/g).length,
    3,
    'one per card, so the browser builds them while parsing',
  );
});

describe('a shadow element carries its styles inside the boundary', async () => {
  const markup = await page();
  const card = markup.slice(markup.indexOf('<person-card'));

  // The rule names `h3` with no prefixing, which is only safe behind a boundary.
  assert.match(card.slice(0, 1200), /<style>[\s\S]*h3\s*\{/);
});

describe('a light element with behavior still ships a definition', async () => {
  const markup = await page();

  assert.match(markup, /<script type="module" src="\/assets\//, 'tally-box has to be registered');
});

describe('an element with neither behavior nor state costs nothing', () => {
  // site-note is styles and a slot. The page ships a client entry for the others,
  // and this one must not be the reason for it.
  const source = fs.readFileSync(path.join(root, 'app', 'elements', 'site-note.html'), 'utf8');

  assert.doesNotMatch(source, /<script>/, 'no behavior block');
  assert.doesNotMatch(source, /export const state/, 'and no state');
});
