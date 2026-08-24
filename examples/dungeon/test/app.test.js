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

describe('a room ships no JavaScript, and the one script tag is data', async () => {
  const page = await read('/dungeon/vault?have=lantern&seen=gate,hall,vault&seed=7f3a');
  const scripts = [...page.matchAll(/<script[^>]*>/g)].map(([tag]) => tag);

  // Speculation rules are read by the browser, not run. Anything else in a
  // <script> would be code this app wrote, and there is none.
  assert.deepEqual(scripts, ['<script type="speculationrules">']);
  assert.doesNotMatch(page, /<script[^>]*\ssrc=/i);
  assert.doesNotMatch(page, /\son[a-z]+=/i);
});

describe('hovering a link never starts a run', async () => {
  // `/dungeon` mints a seed, so a browser rendering it early would spend one.
  // Every room is a server render, which is what keeps it out of `prerender`.
  const page = await read('/dungeon/gate?seen=gate&seed=7f3a');
  const rules = JSON.parse(page.slice(page.indexOf('speculationrules">') + 18, page.indexOf('</script>')));

  assert.deepEqual(rules.prefetch[0].where.or, [{ href_matches: '/dungeon/*' }]);
  assert.ok(!JSON.stringify(rules.prerender ?? []).includes('/dungeon'));
});

describe('the minimap draws what has been seen, and marks where you are', async () => {
  const page = await read('/dungeon/vault?seen=gate,hall,vault&seed=7f3a');
  const chart = page.slice(page.indexOf('id="map"'), page.indexOf('</section>', page.indexOf('id="map"')));
  const names = [...chart.matchAll(/<span class="name">([^<]+)</g)].map(([, name]) => name);

  assert.deepEqual(names, ['The Gate', 'The Long Hall', 'The Vault']);
  assert.equal((chart.match(/aria-current="page"/g) ?? []).length, 1);
  assert.match(chart, /aria-current="page"[^>]*>\s*<span class="dot"[^>]*><\/span>\s*<span class="name">The Vault/);
  assert.match(chart, /3 of 15 rooms/);
});

describe('the minimap is a map and not a menu', async () => {
  // A link on a visited room would be a move nothing checked.
  const page = await read('/dungeon/vault?seen=gate,hall,vault&seed=7f3a');
  const chart = page.slice(page.indexOf('id="map"'), page.indexOf('</section>', page.indexOf('id="map"')));

  assert.doesNotMatch(chart, /<a /);
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

/**
 * A run, one link at a time.
 *
 * The walker only ever follows a link the page it is standing on rendered. So a
 * playthrough here is a claim about the markup rather than about the rules: if
 * an exit is passable and the page did not write it, the walk stops.
 */
async function walk(route) {
  let url = (await get('/dungeon')).headers.get('location');

  for (const room of route) {
    const page = await read(url);
    const next = hrefs(page).find((href) => href.startsWith(`/dungeon/${room}?`));

    assert.ok(next, `no link to ${room} from ${url}`);
    url = next;
  }
  return { url, page: await read(url) };
}

describe('a walk from the gate to the key and back through the door', async () => {
  const { url } = await walk(['hall', 'vault', 'vault', 'hall', 'gallery', 'chapel', 'crypt']);

  assert.match(url, /^\/dungeon\/crypt\?have=brass-key&seen=chapel,crypt,gallery,gate,hall,vault&seed=[0-9a-f]{4}$/);
  assert.equal((await get(url)).status, 200);
});

describe('a whole run, out through the well with the coin', async () => {
  const { url, page } = await walk([
    'hall', 'vault', 'vault', 'guardroom', 'guardroom', 'vault', 'hall', 'gallery', 'chapel',
    'crypt', 'reliquary', 'reliquary', 'crypt', 'chapel', 'gallery', 'stair', 'ossuary',
    'kitchen', 'cistern', 'well',
  ]);

  assert.match(url, /^\/dungeon\/well\?have=brass-key,lantern,silver-coin&/);
  assert.match(page, /You come out with the brass key, the lantern and the silver coin\./);

  // The minimap counts what the URL carries, and nothing else does the counting.
  const seen = new URL(`http://localhost${url}`).searchParams.get('seen').split(',');
  assert.equal(seen.length, 13);
  assert.match(page, new RegExp(`${seen.length} of 15 rooms\\.`));
});

describe('a whole run, down the dark stair with nothing but a light', async () => {
  // The lantern is the only thing this run picks up, and the stair is shut
  // until it does.
  const shut = await read('/dungeon/stair?seen=stair&seed=7f3a');
  assert.equal(hrefs(shut).filter((href) => href.includes('/dungeon/sump')).length, 0);

  const { url, page } = await walk([
    'hall', 'vault', 'guardroom', 'guardroom', 'vault', 'hall', 'gallery', 'stair', 'sump',
  ]);

  assert.match(url, /^\/dungeon\/sump\?have=lantern&/);
  assert.match(page, /You come out with the lantern\./);
  assert.doesNotMatch(page, /<nav class="exits"/);
});

describe('a room reads differently once the thing in it is gone', async () => {
  const before = await read('/dungeon/vault?seen=vault&seed=7f3a');
  const after = await read('/dungeon/vault?have=brass-key&seen=vault&seed=7f3a');

  assert.match(before, /A brass key lies where it fell/);
  assert.doesNotMatch(before, /a clean patch the size of a key/);
  assert.doesNotMatch(after, /Take the brass key/);
  assert.match(after, /a clean patch the size of a key/);
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
