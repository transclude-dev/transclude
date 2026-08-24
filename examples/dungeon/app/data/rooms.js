// The map. Fifteen rooms, and the whole of what the game knows.
//
// A room is a table of nouns, so adding one is filling in the same keys again.
// `graph.js` reads this once, checks it, and refuses to start if an exit names a
// room that is not here.
//
// Coordinates are the minimap and nothing else: `at: [x, y]` is a cell in a
// four by four grid, x east, y down. Two rooms may not share a cell.

/**
 * A way out. A string is a room id. An object is a door with a condition on it.
 *
 * @typedef {{ room: string, requires: string, locked: string }} Door
 * @typedef {string | Door} Exit
 */

/**
 * @typedef {object} Room
 * @property {string} id in the path, so lowercase and no spaces
 * @property {string} title
 * @property {[number, number]} at the cell the minimap draws
 * @property {string[]} prose what is written when the room can be seen
 * @property {string[]} [unlit] read instead when the lantern is not held
 * @property {string[]} [moods] one of these, picked by the seed
 * @property {{ id: string, line: string, gone: string }} [item] what is lying here, and
 *   what the room says once it has been taken
 * @property {Record<string, Exit>} exits
 * @property {boolean} [ending] the run stops here
 */

/** @type {Room[]} */
export const ROOMS = [
  {
    id: 'gate',
    title: 'The Gate',
    at: [0, 0],
    prose: [
      'The gate is shut. The bar is on the far side of it, where you cannot reach.',
      'Whatever you came down here for, you came this way.',
    ],
    exits: { east: 'hall' },
  },
  {
    id: 'hall',
    title: 'The Long Hall',
    at: [1, 0],
    prose: [
      'Two rows of pillars, and a floor worn smooth down the middle.',
      'Somebody walked this often, and long ago.',
    ],
    exits: { west: 'gate', east: 'gallery', south: 'vault' },
  },
  {
    id: 'gallery',
    title: 'The Gallery',
    at: [2, 0],
    prose: ['Frames, and no paintings in them. The nails are still in the wall.'],
    exits: { west: 'hall', east: 'chapel', south: 'stair' },
  },
  {
    id: 'chapel',
    title: 'The Chapel',
    at: [3, 0],
    prose: [
      'Six benches and a stone table, all of it facing the wrong way.',
      'The south wall holds a door of iron.',
    ],
    exits: {
      west: 'gallery',
      south: {
        room: 'crypt',
        requires: 'brass-key',
        locked: 'The iron door is locked. The keyhole is brass, and worn smooth.',
      },
    },
  },
  {
    id: 'guardroom',
    title: 'The Guardroom',
    at: [0, 1],
    prose: ['A bench, a bucket, and a rack for spears with no spears in it.'],
    item: {
      id: 'lantern',
      line: 'A lantern stands on the bench, filled and trimmed.',
      gone: 'The bench holds a ring of clean wood where the lantern stood.',
    },
    exits: { east: 'vault', south: 'cistern' },
  },
  {
    id: 'vault',
    title: 'The Vault',
    at: [1, 1],
    prose: [
      'Dust, and the smell of old coins.',
      'The shelves were emptied in a hurry, by somebody who dropped things.',
    ],
    item: {
      id: 'brass-key',
      line: 'A brass key lies where it fell, under the bottom shelf.',
      gone: 'Under the bottom shelf there is dust, and a clean patch the size of a key.',
    },
    exits: { north: 'hall', west: 'guardroom', east: 'stair', south: 'kitchen' },
  },
  {
    id: 'stair',
    title: 'The Stairhead',
    at: [2, 1],
    prose: [
      'The stair goes down, and the dark starts about four steps in.',
      'The top steps are wet.',
    ],
    exits: {
      north: 'gallery',
      west: 'vault',
      south: 'ossuary',
      down: {
        room: 'sump',
        requires: 'lantern',
        locked: 'The stair goes down into black. Without a light you would be walking blind.',
      },
    },
  },
  {
    id: 'crypt',
    title: 'The Crypt',
    at: [3, 1],
    prose: ['Shelves cut into the rock, and what is left of the people on them.'],
    unlit: ['The dark in here has a shape to it, and the shape is shelves.'],
    exits: { north: 'chapel', south: 'reliquary' },
  },
  {
    id: 'cistern',
    title: 'The Cistern',
    at: [0, 2],
    prose: ['A tank of still water, wide enough to swim and far too cold to.'],
    unlit: ['Water somewhere close, and flat. You keep a hand on the wall.'],
    exits: { north: 'guardroom', east: 'kitchen', south: 'well' },
  },
  {
    id: 'kitchen',
    title: 'The Kitchen',
    at: [1, 2],
    prose: [
      'A hearth, a long table, and a smell that has not left in a hundred years.',
    ],
    exits: { north: 'vault', west: 'cistern', east: 'ossuary', south: 'cellar' },
  },
  {
    id: 'ossuary',
    title: 'The Ossuary',
    at: [2, 2],
    prose: ['Bones, stacked by kind. Somebody counted them, and wrote the count on the wall.'],
    unlit: ['Something under your boot rolls a little way, and stops.'],
    exits: { north: 'stair', west: 'kitchen' },
  },
  {
    id: 'reliquary',
    title: 'The Reliquary',
    at: [3, 2],
    prose: ['A small room off the crypt. This is where the good things were kept.'],
    unlit: ['Small, and close, and you are reading the walls with your hands.'],
    item: {
      id: 'silver-coin',
      line: 'One silver coin sits in a case made for forty.',
      gone: 'The case is empty now, which is nearly what it was before.',
    },
    exits: { north: 'crypt' },
  },
  {
    id: 'well',
    title: 'The Well Shaft',
    at: [0, 3],
    prose: [
      'A shaft, and a circle of grey daylight a long way up.',
      'Irons are set into the wall to climb, and you climb them.',
    ],
    exits: {},
    ending: true,
  },
  {
    id: 'cellar',
    title: 'The Cellar',
    at: [1, 3],
    prose: ['Barrels, every one of them staved in.'],
    unlit: ['Staves and hoops underfoot. You leave them where they are.'],
    moods: [
      'A rat leaves by a hole you cannot find.',
      'Water gets in somewhere above, one drop at a time.',
      'The draught here comes from below, which is the wrong way for a draught.',
    ],
    exits: { north: 'kitchen' },
  },
  {
    id: 'sump',
    title: 'The Sump',
    at: [2, 3],
    prose: [
      'Water to the ankle, then to the knee. The lantern shows more water.',
      'You go on, because the only other way is back, and you did not come down here to go back.',
    ],
    exits: {},
    ending: true,
  },
];

/** Where a run starts. `/dungeon` sends a new one here. */
export const START = 'gate';
