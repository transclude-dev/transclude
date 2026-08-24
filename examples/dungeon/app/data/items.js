// The three things a run can be carrying. An item is a slug in `have`, and
// `have` is a query parameter, so an id has to survive being typed by hand:
// lowercase, and nothing a URL would encode.

/** @typedef {{ id: string, name: string, note: string }} Item */

/** @type {Item[]} */
export const ITEMS = [
  { id: 'brass-key', name: 'brass key', note: 'Worn smooth at the grip.' },
  { id: 'lantern', name: 'lantern', note: 'Brass, and it still holds oil.' },
  { id: 'silver-coin', name: 'silver coin', note: 'Older than the dungeon, probably.' },
];

/**
 * The one item the rooms ask about by name. A room with an `unlit` variant reads
 * one way while this is held and another way while it is not.
 */
export const LIGHT = 'lantern';

/** The item with this id, or null. Anything else is a URL somebody typed. */
export function itemOf(id) {
  return ITEMS.find((item) => item.id === id) ?? null;
}
