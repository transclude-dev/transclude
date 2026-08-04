// The list this app searches and adds to. In memory, like every other example
// here: the point is the request, not the store.

let nextId = 4;

/** @type {{ id: number, name: string, role: string }[]} */
let people = [
  { id: 1, name: 'Ada Lovelace', role: 'Analyst' },
  { id: 2, name: 'Grace Hopper', role: 'Rear admiral' },
  { id: 3, name: 'Karen Spärck Jones', role: 'Researcher' },
];

export const all = () => people;

/** @param {string} query */
export const search = (query) => {
  const needle = query.trim().toLowerCase();
  if (!needle) return people;

  return people.filter(
    (person) =>
      person.name.toLowerCase().includes(needle) || person.role.toLowerCase().includes(needle),
  );
};

/**
 * @param {string} name
 * @param {string} role
 */
export const add = (name, role) => {
  people = [...people, { id: nextId++, name, role: role || 'Unknown' }];
};

/** @param {number} id */
export const remove = (id) => {
  people = people.filter((person) => person.id !== id);
};
