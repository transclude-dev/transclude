# Live

A page that updates itself over server-sent events. Open it in two windows and
type in one.

```sh
npm install
npm run dev     # http://localhost:1969
```

## The stream carries a nudge, not the markup

`app/routes/events.js` is an endpoint that answers with a `ReadableStream` and
never closes it. When the list changes it writes one line:

```
event: notes
data: changed
```

That is all. The client hears it and asks for `/?fragment=feed`, which already
returns the list on its own. Sending rendered HTML down the stream would be a
second way to render the same thing, and the two would drift.

## A stream ends two ways

Both have to unsubscribe:

| | |
| --- | --- |
| the socket closes | `request.signal` fires `abort` |
| the consumer lets go of the reader | the stream's own `cancel()` runs |

Handle one and not the other and you either leak a listener holding a reference
to a dead connection, or close a controller that is already closed. A test
watches the connection count go up and back down.

The first thing it writes is a `: connected` comment. Without it a proxy can
hold an open response with nothing in it, and the browser cannot tell whether it
connected. `x-accel-buffering: no` is the other half of that, for nginx.

## Everything that changes is inside the fragment

The connection count is the last row of the list, not a line above it. A swap
replaces one element, and anything outside it keeps whatever the last full
render left there.

## Without JavaScript

The form posts and the page comes back, the way it would with no stream at all.
The script only changes where the answer goes. A test submits with no script and
asserts the 303.

## Tests

```sh
npm run build && npm test
```

Every test that opens the stream aborts it. One that does not keeps the process
alive, and a run that never exits is worse than one that fails.
