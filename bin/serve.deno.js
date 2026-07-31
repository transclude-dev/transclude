// Deno adapter. `deno run -A framework/bin/serve.deno.js`
//
// `Deno.serve` takes the same (Request) => Response the other two do.

import { app, noBuild, port as configured, summary } from '../src/production.js';

if (noBuild) {
  console.error('No build found. Run `npm run build` first.');
  Deno.exit(1);
}

// Deno reads its own environment, so PORT is applied here rather than
// through the `process` shim.
const port = Number(Deno.env.get('PORT') ?? configured);
Deno.serve({ port, onListen: () => summary(port) }, app.fetch);
