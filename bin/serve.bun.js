// Bun adapter. `bun framework/bin/serve.bun.js`
//
// Bun serves whatever a module default-exports with a `fetch`, so there is no
// listener to write. The app already is one.

import { app, noBuild, port, summary } from '../src/production.js';

if (noBuild) {
  console.error('No build found. Run `npm run build` first.');
  process.exit(1);
}

summary(port);

export default { fetch: app.fetch, port };
