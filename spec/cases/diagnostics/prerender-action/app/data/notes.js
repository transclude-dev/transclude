const all = [];

export const notes = {
  all: () => [...all],
  add: (text) => all.push(text),
};
