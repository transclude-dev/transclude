export const POST = async ({ request, url }) => {
  const shape = new URL(url).searchParams.get('as');
  if (shape === 'json') return Response.json({ parsed: await request.json() });
  if (shape === 'form') return Response.json({ fields: Object.fromEntries(await request.formData()) });
  if (shape === 'bytes') return Response.json({ bytes: (await request.arrayBuffer()).byteLength });
  return new Response(await request.text());
};
