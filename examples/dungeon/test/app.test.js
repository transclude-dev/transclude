// The game as it reaches a browser.
//
// `@transclude/core/production` builds the same app `npm start` serves, from
// `dist`, so these read the real bytes rather than a fixture. They need a build,
// and skip without one rather than failing.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const built = fs.existsSync(path.join(root, 'dist', 'routes.json'));
const describe = built ? test : test.skip;

const { app } = built ? await import('@transclude/core/production') : { app: null };

const get = (url) => app.request(`http://localhost${url}`);
const read = async (url) => (await get(url)).text();

/** Every href in a page, in the order they were written. */
const hrefs = (html) => [...html.matchAll(/href="([^"]+)"/g)].map(([, href]) => href.replace(/&amp;/g, '&'));

describe('a room ships no script at all', async () => {
  const page = await read('/dungeon/vault?have=lantern&seen=gate,hall,vault&seed=7f3a');

  assert.doesNotMatch(page, /<script/i);
  assert.doesNotMatch(page, /\son[a-z]+=/i);
});

describe('the same URL twice is the same bytes', async () => {
  const url = '/dungeon/cellar?have=lantern&seen=cellar,gate&seed=7f3a';

  assert.equal(await read(url), await read(url));
});

describe('the seeded line is the seed and the room, not the moment', async () => {
  const one = await read('/dungeon/cellar?seen=cellar&seed=7f3a');
  const two = await read('/dungeon/cellar?seen=cellar&seed=0c11');

  const moodOf = (page) => page.slice(page.indexOf('<p>'), page.indexOf('<nav'));

  assert.notEqual(moodOf(one), moodOf(two));
  assert.equal(moodOf(one), moodOf(await read('/dungeon/cellar?seen=cellar&seed=7f3a')));
});

describe('a new run is a redirect, and every one of them is different', async () => {
  const first = await get('/dungeon');
  const second = await get('/dungeon');

  assert.equal(first.status, 303);
  assert.match(first.headers.get('location'), /^\/dungeon\/gate\?seen=gate&seed=[0-9a-f]{4}$/);
  assert.notEqual(first.headers.get('location'), second.headers.get('location'));
});

describe('a shut door is not a link, and the room behind it is in no href', async () => {
  const page = await read('/dungeon/chapel?seen=chapel&seed=7f3a');

  assert.match(page, /<span class="shut">/);
  assert.match(page, /iron door is locked/);
  assert.equal(hrefs(page).filter((href) => href.includes('/dungeon/crypt')).length, 0);
});

describe('the key opens it, even typed in by hand', async () => {
  // Nobody visited the vault in this URL. The door reads `have`, not a history.
  const page = await read('/dungeon/chapel?have=brass-key&seen=chapel&seed=7f3a');

  assert.doesNotMatch(page, /<span class="shut">/);
  assert.ok(hrefs(page).some((href) => href.startsWith('/dungeon/crypt?have=brass-key')));
});

describe('a walk from the gate to the key and back through the door', async () => {
  let url = (await get('/dungeon')).headers.get('location');
  const walked = [];

  for (const room of ['hall', 'vault', 'vault', 'hall', 'gallery', 'chapel', 'crypt']) {
    const page = await read(url);
    // Only ever follow a link the page actually offered.
    const next = hrefs(page).find((href) => href.startsWith(`/dungeon/${room}?`));

    assert.ok(next, `no link to ${room} from ${url}`);
    url = next;
    walked.push(url);
  }

  assert.match(url, /^\/dungeon\/crypt\?have=brass-key&seen=chapel,crypt,gallery,gate,hall,vault&seed=[0-9a-f]{4}$/);
  assert.equal((await get(url)).status, 200);
});

describe('the room panel is a URL of its own', async () => {
  const url = '/dungeon/gate?seen=gate&seed=7f3a';
  const panel = await read(`${url}&fragment=room`);
  const page = await read(url);

  assert.doesNotMatch(panel, /<html|<body|class="pack"/);
  assert.match(panel, /^<section id="room"/);
  assert.ok(page.includes(panel.trim()), 'the panel is a substring of the page it came from');
});

describe('a region nobody declared is a 404', async () => {
  assert.equal((await get('/dungeon/gate?seen=gate&seed=7f3a&fragment=nope')).status, 404);
});

describe('a room nobody wrote is a 404 that says so', async () => {
  const res = await get('/dungeon/atlantis?seed=7f3a');

  assert.equal(res.status, 404);
  assert.match(await res.text(), /no room called/i);
});

describe('a hand-edited URL degrades rather than erroring', async () => {
  const res = await get('/dungeon/cellar?have=sword&seen=atlantis&seed=zzzz&utm_source=x');

  assert.equal(res.status, 200);
  const page = await res.text();
  // Nothing it could not read reaches the next move.
  for (const href of hrefs(page).filter((href) => href.startsWith('/dungeon/'))) {
    assert.doesNotMatch(href, /sword|atlantis|zzzz|utm_source/);
  }
});

describe('an ending is the end: no exits, and a way to start again', async () => {
  const page = await read('/dungeon/well?have=silver-coin&seen=cistern,well&seed=7f3a');

  assert.doesNotMatch(page, /<nav class="exits"/);
  assert.match(page, /You come out with the silver coin\./);
  assert.ok(hrefs(page).includes('/dungeon'));
});
