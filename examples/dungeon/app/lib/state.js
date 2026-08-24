// The save file, which is the query string.
//
//   /dungeon/vault?have=brass-key,lantern&seen=gate,hall,vault&seed=7f3a
//
// Two rules hold the whole thing up.
//
// Canonical. Every list is lowercased, deduped and sorted before it is written,
// so two runs holding the same things produce the same URL, character for
// character. History, the back button and any cache in between all key on that.
//
// Tolerant. Anything unknown is dropped rather than refused: an item that is not
// an item, a room that is not a room, a seed that is not four hex characters, a
// parameter nobody wrote. A URL somebody hand-edited plays; it never answers 500.

import { itemOf } from '../data/items.js';
import { roomOf } from './graph.js';
import { seedOf } from './rng.js';

/**
 * @typedef {object} State
 * @property {string[]} have items held, sorted
 * @property {string[]} seen rooms visited, sorted
 * @property {string} seed four hex characters
 */

/** Sorted, deduped, and only what `known` recognizes. */
function list(text, known) {
  const parts = String(text ?? '')
    .toLowerCase()
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part && known(part));

  return [...new Set(parts)].sort();
}

/**
 * The state a URL carries.
 *
 * @param {string} url
 * @returns {State}
 */
export function parse(url) {
  const params = new URL(url).searchParams;

  return {
    have: list(params.get('have'), (id) => itemOf(id) !== null),
    seen: list(params.get('seen'), (id) => roomOf(id) !== null),
    seed: seedOf(params.get('seed')),
  };
}

/**
 * The URL of a move, with the state it arrives holding.
 *
 * The destination is added to `seen` here rather than when the page renders it,
 * so what the link says is what the next page reads. `add` is an item picked up
 * on the way, which is how a pickup is a link to the room you are already in.
 *
 * Commas are written as commas. They are legal in a query string, every id is
 * checked against `/^[a-z][a-z0-9-]*$/` when the map loads, and
 * `URLSearchParams` would write `%2C` and make the save file unreadable.
 *
 * @param {State} state
 * @param {{ room: string, add?: string }} move
 */
export function href(state, { room, add }) {
  const have = add ? [...new Set([...state.have, add])].sort() : state.have;
  const seen = [...new Set([...state.seen, room])].sort();

  const query = [];
  if (have.length) query.push(`have=${have.join(',')}`);
  query.push(`seen=${seen.join(',')}`);
  query.push(`seed=${state.seed}`);

  return `/dungeon/${room}?${query.join('&')}`;
}
