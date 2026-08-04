// Signing out is a POST, because a GET must not change anything. A link that
// signs you out is a link something else can follow on your behalf.

export const POST = ({ cookies, url }) => {
  cookies.delete('session', { path: '/' });

  return Response.redirect(new URL('/', url), 303);
};
