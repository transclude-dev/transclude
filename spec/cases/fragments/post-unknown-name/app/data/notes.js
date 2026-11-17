let items = [];

export const notes = {
  all: () => items,
  add: (text) => {
    items = [...items, text];
  },
};
