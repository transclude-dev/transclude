const said = (method) => () => new Response(`${method} ran`, { headers: { 'x-ran': method } });

export const GET = said('GET');
export const HEAD = said('HEAD');
export const POST = said('POST');
export const PUT = said('PUT');
export const PATCH = said('PATCH');
export const DELETE = said('DELETE');
export const OPTIONS = said('OPTIONS');
