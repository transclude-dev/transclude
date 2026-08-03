// Globals the adapters use, declared so the source check can read them.
//
// `bin/serve.deno.js` runs under Deno and nowhere else, so `Deno` is a global
// there and undefined everywhere. Without this the check reports it as a name
// that does not exist, which is the same thing it reports for a real mistake,
// and one drowns the other.

declare const Deno: {
  exit(code?: number): never;
  env: { get(name: string): string | undefined };
  serve(
    options: { port: number; onListen?: () => void },
    handler: (request: Request) => Response | Promise<Response>,
  ): unknown;
};
