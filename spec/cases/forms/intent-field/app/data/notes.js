let items = [];
let next = 1;

export const notes = {
  all: () => items,
  add: (text) => {
    items = [...items, { id: next++, text }];
  },
  remove: (id) => {
    items = items.filter((note) => note.id !== id);
  },
};
