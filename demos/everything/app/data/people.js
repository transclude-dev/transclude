// Imported from <script server> blocks with a relative specifier. The generated
// page module is virtual and has no directory of its own, so the plugin resolves
// these against the .html file the block was written in.

export const people = [
  {
    slug: 'ada-lovelace',
    name: 'Ada Lovelace',
    role: 'Analyst',
    tags: ['notes', 'engines'],
    since: 1843,
    joined: new Date(Date.UTC(1843, 11, 10)),
    note: 'Wrote the first algorithm intended for a machine.',
  },
  {
    slug: 'grace-hopper',
    name: 'Grace Hopper',
    role: 'Rear Admiral',
    tags: ['compilers'],
    since: 1952,
    joined: new Date(Date.UTC(1952, 4, 6)),
    note: 'Built the first compiler, and argued for machine-independent languages.',
  },
  {
    slug: 'radia-perlman',
    name: 'Radia Perlman',
    role: '',
    tags: [],
    since: 1985,
    joined: new Date(Date.UTC(1985, 0, 22)),
    note: 'Designed the spanning-tree protocol that made large bridged networks work.',
  },
];

export function bySlug(slug) {
  return people.find((person) => person.slug === slug) ?? null;
}
