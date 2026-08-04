// The one endpoint. It answers with a stream that stays open, and writes a line
// every time the list changes.
//
// What it sends is a nudge, not the markup. The page already has a URL that
// returns the list on its own, so the client asks for that. Sending rendered
// HTML down this channel would be a second way to render the same thing.

import { onChange } from '../data/board.js';

export const GET = ({ request }) => {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (event) => controller.enqueue(encoder.encode(event));

      // A first line straight away. Without it a proxy may hold the response
      // open with nothing in it, and the browser has no idea it connected.
      send(': connected\n\n');

      const stop = onChange(() => send('event: notes\ndata: changed\n\n'));

      // The client going away is the only way this ends. Node fires abort when
      // the socket closes; without this the listener outlives the connection
      // and holds it forever.
      request.signal.addEventListener('abort', () => {
        stop();
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      // Tells nginx and friends not to buffer, which would defeat the whole
      // thing by holding every line until the response ends.
      'x-accel-buffering': 'no',
    },
  });
};
