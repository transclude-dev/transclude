export const GET = async ({ cookies }) => {
  cookies.delete('a');
  return new Response('ok');
};
