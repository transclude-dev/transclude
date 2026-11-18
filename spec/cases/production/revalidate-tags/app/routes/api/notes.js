// app/routes/api/notes.js
export const POST = async ({ revalidateTag }) => {
  // Every held page carrying this tag is dropped. The next request for one
  // renders it again.
  revalidateTag('notes');

  return new Response(null, { status: 204 });
};
