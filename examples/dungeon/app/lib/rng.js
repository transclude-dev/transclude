// Randomness that a URL can carry.
//
// Nothing here samples at request time. A run gets one seed, every link carries
// it forward, and anything that varies is derived from the seed and the place it
// varies in. So a room reads the same on the second visit as on the first, and
// the back button is an undo rather than a reroll.

/** The seed a URL falls back to when it names none. */
export const DEFAULT_SEED = '0000';

const SEED = /^[0-9a-f]{4}$/;

/** A seed as written, or the default. A hand-typed URL degrades, never throws. */
export function seedOf(text) {
  const seed = String(text ?? '').toLowerCase();
  return SEED.test(seed) ? seed : DEFAULT_SEED;
}

/** A fresh seed. `crypto` is a global on all four runtimes; `node:crypto` is not. */
export function mint() {
  const [n] = crypto.getRandomValues(new Uint16Array(1));
  return n.toString(16).padStart(4, '0');
}

/**
 * FNV-1a, and then a mix.
 *
 * The mix is the load-bearing half. Without it two strings differing in their
 * last character land next to each other, and `% 3` reads both as the same roll,
 * which is exactly what `${seed}:${room}:${key}` produces.
 */
function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return h >>> 0;
}

/** Which of `n` this run gets, here, for this event. Same URL, same answer. */
export function roll(seed, roomId, eventKey, n) {
  return hash(`${seed}:${roomId}:${eventKey}`) % n;
}
