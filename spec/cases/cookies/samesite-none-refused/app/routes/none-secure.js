export const GET = async ({ cookies }) => {
  cookies.set('a', '1', { sameSite: 'None', secure: true });
  return new Response('ok');
};
