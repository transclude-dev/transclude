// An endpoint: a `.js` file in the pages tree. Same filename conventions as a
// page, so this one is `/api/people`, but with no template, no layout and no
// fragments. It answers with a Response of its own.
//
// Handlers are named for the method the way HTTP spells it. Uppercase is doing
// real work: `export const delete` is a syntax error, `export const DELETE` is
// not. A page's handlers are spelled the same way.

import { people } from '../../data/people.js';

const shape = (person) => ({
  slug: person.slug,
  name: person.name,
  role: person.role,
  tags: person.tags,
  since: person.since,
});

/** @param {{ url: string }} ctx */
export const GET = ({ url }) => {
  const q = new URL(url).searchParams.get('q')?.toLowerCase();
  const matches = q ? people.filter((p) => p.name.toLowerCase().includes(q)) : people;

  return Response.json(
    { count: matches.length, people: matches.map(shape) },
    // An endpoint owns its whole response, caching included. Nothing here is
    // wrapped in the document server's defaults.
    { headers: { 'Cache-Control': 'public, max-age=60' } },
  );
};

/** Anything not exported here is a 405 with an Allow header, not a 404. */
export const HEAD = () => new Response(null, { status: 204 });
