// Time passing, as a request. The runner asks one thing at a time, so a case
// that needs a window to close asks for this.
export const GET = async ({ url }) => {
  const ms = Number(new URL(url).searchParams.get('ms'));
  await new Promise((done) => setTimeout(done, ms));
  return new Response('waited');
};
