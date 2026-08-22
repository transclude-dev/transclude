#!/usr/bin/env node
// Node adapter. The app is in src/production.js; this listens with it.

import { serve } from '@hono/node-server';
import { drainOn } from '../src/drain.js';
import { app, noBuild, port, summary } from '../src/production.js';

if (noBuild) {
  console.error('No build found. Run `npm run build` first.');
  process.exit(1);
}

const server = serve({ fetch: app.fetch, port }, ({ port }) => summary(port));

// A container sends SIGTERM and waits. Node's default is to die on the spot,
// which cuts a render that was halfway through answering.
drainOn(server);
