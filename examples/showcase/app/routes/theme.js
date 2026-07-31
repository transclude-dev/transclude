// The theme toggle, with no client JavaScript.
//
// A form posts here, this sets a cookie and redirects back, and the layout's
// loader reads the cookie on the way through and puts it on `<html>`. Hypermedia
// all the way down: the button is a submit, the answer is a 303, and the browser
// does what it has always done with those.

/** A year. The choice should outlive the session that made it. */
const A_YEAR = 60 * 60 * 24 * 365;

const THEMES = ['light', 'dark', 'auto'];

export const POST = async ({ request, cookies }) => {
  const form = await fields(request);
  if (!form) return new Response('expected a form submission', { status: 400 });

  const theme = String(form.get('theme') ?? '');
  // Whatever came back is going into an attribute and into a cookie, so it is
  // checked against the list rather than trusted.
  if (!THEMES.includes(theme)) return new Response(`no theme "${theme}"`, { status: 400 });

  if (theme === 'auto') cookies.delete('theme');
  else cookies.set('theme', theme, { maxAge: A_YEAR, path: '/', sameSite: 'Lax' });

  // Back where the form was, so the toggle works from any page. A relative path
  // only, or this would be an open redirect: `from` arrives from the client.
  const from = String(form.get('from') ?? '/');
  const back = from.startsWith('/') && !from.startsWith('//') ? from : '/';

  return Response.redirect(new URL(back, request.url), 303);
};

/**
 * `request.formData()` throws when the body is not a form. That is the caller's
 * mistake and deserves a 400; letting it escape makes it a 500.
 *
 * @param {Request} request
 */
async function fields(request) {
  try {
    return await request.formData();
  } catch {
    return null;
  }
}
