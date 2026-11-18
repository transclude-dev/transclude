export const GET = async ({ cookies }) => {
  cookies.set('a', '1', { path: '/x', httpOnly: false, sameSite: 'Strict', maxAge: 60 });
  return new Response('ok');
};
