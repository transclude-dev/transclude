export const GET = () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(': connected\n\n'));
      controller.enqueue(encoder.encode('event: notes\ndata: changed\n\n'));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' },
  });
};
