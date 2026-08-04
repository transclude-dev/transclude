// The store, in memory, because this example is about the request cycle rather
// than about storage. Swap this file for a database and nothing above it
// changes: every route reads and writes through these functions.
//
// One process holds one list, so everyone looking at the running app sees the
// same todos. That is wrong for a real app and right for a demo you open in two
// windows to watch a form submission land.

let nextId = 1;

/** @type {{ id: number, text: string, done: boolean }[]} */
let items = [
  { id: nextId++, text: 'Taste JavaScript', done: true },
  { id: nextId++, text: 'Buy a unicorn', done: false },
];

/** @returns {{ id: number, text: string, done: boolean }[]} */
export const all = () => items;

/** @param {string} text */
export const add = (text) => {
  items.push({ id: nextId++, text, done: false });
};

/** @param {number} id */
export const toggle = (id) => {
  const todo = items.find((item) => item.id === id);
  if (todo) todo.done = !todo.done;
};

/** @param {number} id */
export const remove = (id) => {
  items = items.filter((item) => item.id !== id);
};

/**
 * @param {number} id
 * @param {string} text
 */
export const rename = (id, text) => {
  const todo = items.find((item) => item.id === id);
  if (todo) todo.text = text;
};

/** @param {boolean} done */
export const markAll = (done) => {
  for (const item of items) item.done = done;
};

export const clearDone = () => {
  items = items.filter((item) => !item.done);
};
