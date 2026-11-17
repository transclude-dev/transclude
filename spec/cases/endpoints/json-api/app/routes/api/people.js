import { people } from '../../data/people.js';

export const GET = (ctx) => Response.json(people);

export const POST = async ({ request }) => {
  const body = await request.json();
  people.push(body);
  return Response.json(body, { status: 201 });
};
