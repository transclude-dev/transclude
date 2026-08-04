// A list everyone shares, and a way to hear about changes.
//
// One process, one list, one set of listeners. That is what makes this a demo
// you open in two windows. Across more than one process the listeners live in
// something both can reach, and the shape above them does not change.

let nextId = 1;

/** @type {{ id: number, text: string, at: number }[]} */
let notes = [{ id: nextId++, text: 'Open this in a second window.', at: 0 }];

/** @type {Set<() => void>} */
const listeners = new Set();

export const all = () => notes;

/** @param {string} text */
export function add(text) {
  notes = [...notes, { id: nextId++, text, at: notes.length }].slice(-12);
  for (const tell of listeners) tell();
}

/**
 * Adds a listener and returns the function that removes it. Every caller has to
 * call that: a listener for a connection that has gone is a leak with a
 * reference to the whole request in it.
 *
 * @param {() => void} listener
 * @returns {() => void}
 */
export function onChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** For a test, and for the page to say how many are connected. */
export const listening = () => listeners.size;
