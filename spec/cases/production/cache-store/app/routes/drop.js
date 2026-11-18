export const POST = ({ revalidateTag }) => {
  revalidateTag('notes');
  return new Response(null, { status: 204 });
};
