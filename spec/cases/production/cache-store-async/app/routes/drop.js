export const POST = async ({ revalidateTag }) => {
  await revalidateTag('notes');
  return new Response(null, { status: 204 });
};
