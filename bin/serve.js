#!/usr/bin/env node
// Node adapter. The app is in src/production.js; this listens with it.

import { serve } from '@hono/node-server';
import { app, noBuild, port, summary } from '../src/production.js';

if (noBuild) {
  console.error('No build found. Run `npm run build` first.');
  process.exit(1);
}

serve({ fetch: app.fetch, port }, ({ port }) => summary(port));
