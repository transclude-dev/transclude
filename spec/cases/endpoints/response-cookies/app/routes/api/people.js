export const POST = async ({ cookies, request }) => {
  const form = await request.formData();
  cookies.set('seen', '1', { maxAge: 604800 });
  return new Response('made', {
    status: 201,
    headers: { location: '/api/people/' + form.get('id') },
  });
};
