// The one endpoint. It answers with a stream that stays open, and writes a line
// every time the list changes.
//
// What it sends is a nudge, not the markup. The page already has a URL that
// returns the list on its own, so the client asks for that. Sending rendered
// HTML down this channel would be a second way to render the same thing.

import { onChange } from '../data/board.js';

export const GET = ({ request }) => {
  const encoder = new TextEncoder();

  // A stream ends two ways, and both have to unsubscribe. The socket closing
  // fires `abort` on the request signal; the consumer letting go of the reader
  // calls `cancel` on the stream. Handle one and not the other and you either
  // leak a listener or close a controller that is already closed.
  let open = true;
  let unsubscribe = () => {};

  const done = () => {
    if (!open) return;
    open = false;
    unsubscribe();
  };

  const stream = new ReadableStream({
    start(controller) {
      // Guarded, because a change can arrive in the moment between the socket
      // going and this hearing about it.
      const send = (event) => {
        if (open) controller.enqueue(encoder.encode(event));
      };

      // Something straight away. Without it a proxy may hold the response open
      // with nothing in it, and the browser cannot tell it connected.
      send(': connected\n\n');

      unsubscribe = onChange(() => send('event: notes\ndata: changed\n\n'));

      request.signal.addEventListener('abort', () => {
        done();
        // The consumer may have closed it already, in which case this throws.
        try {
          controller.close();
        } catch {}
      });
    },

    cancel() {
      // The consumer went away. Nothing to close: it is closing.
      done();
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
