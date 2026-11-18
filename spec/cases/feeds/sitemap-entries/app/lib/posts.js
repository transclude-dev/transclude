export async function posts() {
  return [
    { slug: 'first', title: 'First', date: '2026-01-05', summary: 'The first post.' },
    { slug: 'third', title: 'Third', date: '2026-03-20', summary: 'The <em>third</em> post.' },
    { slug: 'second', title: 'Second', date: '2026-02-11', summary: 'The second post.' },
  ];
}
