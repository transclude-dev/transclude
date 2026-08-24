// Randomness a URL can carry.

import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_SEED, mint, roll, seedOf } from '../app/lib/rng.js';

test('the same seed, room and event is the same answer, always', () => {
  assert.equal(roll('7f3a', 'cellar', 'mood', 3), roll('7f3a', 'cellar', 'mood', 3));
});

test('a roll stays inside the range it was given', () => {
  for (let n = 0; n < 500; n += 1) {
    const seed = (n % 65536).toString(16).padStart(4, '0');
    const value = roll(seed, 'cellar', 'mood', 3);

    assert.ok(Number.isInteger(value) && value >= 0 && value < 3, `${seed} rolled ${value}`);
  }
});

test('three moods are three moods, not one', () => {
  // The mix in `hash` is what buys this. FNV-1a alone puts consecutive seeds
  // next to each other, and `% 3` reads a run of them as the same answer.
  const seen = new Set();
  for (let n = 0; n < 60; n += 1) {
    seen.add(roll(n.toString(16).padStart(4, '0'), 'cellar', 'mood', 3));
  }

  assert.equal(seen.size, 3);
});

test('one room rolling does not decide another room', () => {
  const rolls = ['cellar', 'crypt', 'well'].map((room) => roll('7f3a', room, 'mood', 1000));

  assert.equal(new Set(rolls).size, 3);
});

test('a seed that is not a seed reads as the default', () => {
  assert.equal(seedOf('zzzz'), DEFAULT_SEED);
  assert.equal(seedOf(''), DEFAULT_SEED);
  assert.equal(seedOf('7F3A'), '7f3a');
  assert.equal(seedOf('7f3a7f3a'), DEFAULT_SEED);
});

test('a minted seed is four hex characters', () => {
  for (let n = 0; n < 50; n += 1) assert.match(mint(), /^[0-9a-f]{4}$/);
});
