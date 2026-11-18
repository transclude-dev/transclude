export const GET = async ({ cookies }) => {
  cookies.set('a', '1');
  return new Response('ok');
};
