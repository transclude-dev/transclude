// A `Response` for Bun that writes a text body's type into its headers.
//
// The Fetch standard puts a string body's `text/plain;charset=UTF-8` into
// `headers` when the response is made, and Node, Deno and workerd do. Bun keeps
// it out and decides it when it sends. A copy built from the headers and the
// body stream then has no type, and Bun sends it as `application/octet-stream`.
// Hono makes that copy whenever it replaces a response a middleware already
// read, so on Bun every `new Response('ok')` from an endpoint that set a cookie
// went out as bytes. `npm run spec:runtimes` found it.
//
// Imported first by `serve.bun.js`, so every module after it, the app's
// included, makes this one. Only a string body is missing its type on Bun, so
// only that one is filled in.

// A `Proxy` on the constructor and not a subclass. `Response.json()` and
// `fetch()` make Bun's own class whatever the global is, and a subclass would
// fail `instanceof Response` for those, which is how an endpoint's answer is
// recognized. The proxy passes everything through, statics and `instanceof`
// included, and only adds the header after `new`.
globalThis.Response = new Proxy(globalThis.Response, {
  construct(target, args, newTarget) {
    const response = Reflect.construct(target, args, newTarget);
    const [body] = args;
    if (typeof body === 'string' && !response.headers.has('content-type')) {
      response.headers.set('content-type', 'text/plain;charset=UTF-8');
    }
    return response;
  },
});
