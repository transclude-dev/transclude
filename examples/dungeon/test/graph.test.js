// The map, and what a broken one has to say for itself.
//
// Every case here is a map somebody could write by hand, and the assertion is on
// the message rather than on the throw: a check that fires with the wrong words
// costs the next person the evening the check was written to save them.

import test from 'node:test';
import assert from 'node:assert/strict';

import { check, exitsFrom, roomOf, rooms } from '../app/lib/graph.js';
import { ITEMS } from '../app/data/items.js';
import { ROOMS, START } from '../app/data/rooms.js';

/** A map that passes, to break one key at a time. */
function map() {
  return [
    { id: 'gate', title: 'The Gate', at: [0, 0], prose: [], exits: { east: 'hall' } },
    {
      id: 'hall',
      title: 'The Hall',
      at: [1, 0],
      prose: [],
      item: { id: 'key', line: 'A key.' },
      exits: { west: 'gate', east: 'vault' },
    },
    { id: 'vault', title: 'The Vault', at: [2, 0], prose: [], exits: {}, ending: true },
  ];
}

const items = [{ id: 'key', name: 'key', note: '' }];

/** The message of what `check` throws, or '' when it does not throw. */
function refusal(rooms) {
  try {
    check(rooms, items, 'gate');
    return '';
  } catch (err) {
    return err.message;
  }
}

test('the map this app ships passes its own checks', () => {
  assert.equal(check(ROOMS, ITEMS, START).size, ROOMS.length);
  assert.equal(rooms.length, 15);
});

test('a map with nothing wrong is accepted', () => {
  assert.equal(refusal(map()), '');
});

test('an exit to a room that is not there names both', () => {
  const rooms = map();
  rooms[0].exits.east = 'halll';

  assert.match(refusal(rooms), /gate east leads to "halll", which is not a room/);
});

test('a lock naming an item that is not there is refused', () => {
  const rooms = map();
  rooms[1].exits.east = { room: 'vault', requires: 'skeleton-key', locked: 'Shut.' };

  assert.match(refusal(rooms), /hall east needs "skeleton-key", which is not an item/);
});

test('a lock with no words for the player is refused', () => {
  const rooms = map();
  rooms[1].exits.east = { room: 'vault', requires: 'key' };

  assert.match(refusal(rooms), /hall east is locked and says nothing about it/);
});

test('a key behind the door it opens is refused', () => {
  // The classic broken map, and the reason the walk collects items as it goes.
  const rooms = map();
  rooms[1].item = null;
  rooms[2].item = { id: 'key', line: 'A key.' };
  rooms[1].exits.east = { room: 'vault', requires: 'key', locked: 'Shut.' };

  assert.match(refusal(rooms), /vault cannot be reached from gate/);
});

test('two rooms in one cell are refused, because the minimap draws by cell', () => {
  const rooms = map();
  rooms[2].at = [1, 0];

  assert.match(refusal(rooms), /vault and hall are both at \[1,0\]/);
});

test('an id a URL would mangle is refused', () => {
  const rooms = map();
  rooms[2].id = 'The Vault';
  rooms[1].exits.east = 'The Vault';

  assert.match(refusal(rooms), /"The Vault" is not a usable id/);
});

test('an ending with a way out of it is refused', () => {
  const rooms = map();
  rooms[2].exits = { west: 'hall' };

  assert.match(refusal(rooms), /vault ends the run and has exits/);
});

test('an item nobody put anywhere is refused', () => {
  const rooms = map();
  rooms[1].item = null;

  assert.match(refusal(rooms), /key is not in any room/);
});

test('a shut exit carries the words and no room to walk to', () => {
  const [south] = exitsFrom(roomOf('chapel'), []);

  assert.equal(south.dir, 'south');
  assert.equal(south.passable, false);
  assert.match(south.locked, /iron door is locked/);
});

test('the same exit opens the moment the item is held', () => {
  const [south] = exitsFrom(roomOf('chapel'), ['brass-key']);

  assert.equal(south.passable, true);
  assert.equal(south.locked, null);
});

test('exits come out in compass order however the room wrote them', () => {
  const dirs = exitsFrom(roomOf('vault'), []).map((exit) => exit.dir);

  assert.deepEqual(dirs, ['north', 'east', 'south', 'west']);
});

test('a room nobody wrote is null rather than a throw', () => {
  assert.equal(roomOf('atlantis'), null);
  assert.equal(roomOf(''), null);
  assert.equal(roomOf(undefined), null);
});
