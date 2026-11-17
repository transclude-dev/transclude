import { label } from './_shared.js';

export const GET = ({ params }) => new Response(label(params.rest));
