export const GET = async ({ cookies }) => {
  await cookies.signed.set('user', 'ada');
  return new Response('ok');
};
