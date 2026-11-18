export const GET = async ({ cookies }) => {
  cookies.set('a', '1', { sameSite: 'None' });
  return new Response('ok');
};
