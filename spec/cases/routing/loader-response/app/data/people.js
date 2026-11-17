const people = [{ slug: 'ada', name: 'Ada Lovelace' }];

export const find = (slug) => people.find((p) => p.slug === slug);
