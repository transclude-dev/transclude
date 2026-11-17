export const GET = ({ cookies, url }) => {
  cookies.set('session', 'ada');
  return Response.redirect(new URL('/account', url), 302);
};
