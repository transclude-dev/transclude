// The save file, read and written.
//
// The property that matters is that two runs holding the same things produce the
// same URL, character for character. Everything downstream leans on it: history,
// the back button, a bookmark, and any cache between here and the reader.

import test from 'node:test';
import assert from 'node:assert/strict';

import { href, parse } from '../app/lib/state.js';
import { DEFAULT_SEED } from '../app/lib/rng.js';

const at = (query) => `http://localhost/dungeon/vault${query}`;

test('order does not survive the parse, so it cannot reach the URL', () => {
  const one = parse(at('?have=lantern,brass-key&seen=hall,gate&seed=7f3a'));
  const two = parse(at('?have=brass-key,lantern&seen=gate,hall&seed=7f3a'));

  assert.deepEqual(one, two);
  assert.equal(href(one, { room: 'stair' }), href(two, { room: 'stair' }));
});

test('the canonical href is what the plan promised', () => {
  const state = parse(at('?have=lantern,brass-key&seen=gate,hall&seed=7f3a'));

  assert.equal(
    href(state, { room: 'stair' }),
    '/dungeon/stair?have=brass-key,lantern&seen=gate,hall,stair&seed=7f3a',
  );
});

test('parse and href round-trip', () => {
  const first = parse(at('?have=lantern&seen=gate,hall&seed=1234'));
  const url = href(first, { room: 'vault' });
  const second = parse(`http://localhost${url}`);

  assert.deepEqual(second, { have: ['lantern'], seen: ['gate', 'hall', 'vault'], seed: '1234' });
  assert.equal(href(second, { room: 'vault' }), url);
});

test('a repeat of the same move is the same URL', () => {
  const state = parse(at('?have=lantern&seen=gate,vault&seed=1234'));

  assert.equal(href(state, { room: 'vault' }), href(state, { room: 'vault' }));
  assert.equal(href(state, { room: 'vault', add: 'lantern' }), href(state, { room: 'vault' }));
});

test('an item that is not an item is dropped, and the rest of the URL plays', () => {
  const state = parse(at('?have=sword,lantern,LANTERN&seen=gate,atlantis&seed=7f3a'));

  assert.deepEqual(state.have, ['lantern']);
  assert.deepEqual(state.seen, ['gate']);
});

test('a seed that is not a seed reads as the default rather than as an error', () => {
  assert.equal(parse(at('?seed=zzzz')).seed, DEFAULT_SEED);
  assert.equal(parse(at('')).seed, DEFAULT_SEED);
  assert.equal(parse(at('?seed=7F3A')).seed, '7f3a');
});

test('a parameter nobody wrote does not reach the next URL', () => {
  const state = parse(at('?have=lantern&seen=gate&seed=7f3a&utm_source=somewhere'));

  assert.equal(href(state, { room: 'hall' }), '/dungeon/hall?have=lantern&seen=gate,hall&seed=7f3a');
});

test('an empty hand writes no `have` at all', () => {
  const state = parse(at('?seen=gate&seed=7f3a'));

  assert.equal(href(state, { room: 'hall' }), '/dungeon/hall?seen=gate,hall&seed=7f3a');
});

test('picking something up is a link to the room you are standing in', () => {
  const state = parse(at('?seen=gate,vault&seed=7f3a'));

  assert.equal(
    href(state, { room: 'vault', add: 'brass-key' }),
    '/dungeon/vault?have=brass-key&seen=gate,vault&seed=7f3a',
  );
});

test('a comma is written as a comma, so the URL stays readable', () => {
  const state = parse(at('?have=brass-key,lantern&seen=gate&seed=7f3a'));

  assert.doesNotMatch(href(state, { room: 'hall' }), /%2C/i);
});
