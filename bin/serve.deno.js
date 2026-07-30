// Deno adapter. `deno run -A framework/bin/serve.deno.js`
//
// `Deno.serve` takes the same (Request) => Response the other two do.

import { app, noBuild, summary } from '../src/production.js';

if (noBuild) {
  console.error('No build found. Run `npm run build` first.');
  Deno.exit(1);
}

const port = Number(Deno.env.get('PORT') ?? 3000);
Deno.serve({ port, onListen: () => summary(port) }, app.fetch);
