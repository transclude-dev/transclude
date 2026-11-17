import { people } from '../../../data/people.js';

export const GET = ({ params }) => {
  const person = people.find((p) => p.id === params.id);
  if (!person) return Response.json({ error: 'not found' }, { status: 404 });
  return Response.json(person);
};

export const PATCH = async ({ params, request }) => {
  const person = people.find((p) => p.id === params.id);
  if (!person) return Response.json({ error: 'not found' }, { status: 404 });
  Object.assign(person, await request.json());
  return Response.json(person);
};

export const DELETE = ({ params }) => {
  const at = people.findIndex((p) => p.id === params.id);
  if (at === -1) return Response.json({ error: 'not found' }, { status: 404 });
  people.splice(at, 1);
  return new Response(null, { status: 204 });
};
