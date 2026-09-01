// Cloudflare Workers entry. `npm run deploy` sends it.
//
// This file belongs to the app, because every import in it names something the
// app owns, and a bundler needs a literal path to follow. The wiring behind
// `workerFrom` does not, which is why it lives in the framework.
//
// Deploying somewhere else? Delete this and `wrangler.jsonc`. `npm start`
// serves the same build on Node, Bun and Deno.

import { workerFrom } from '@transclude/core/worker';
import * as bundle from './dist/server/assets.js';
import * as entry from './dist/server/entry.js';
import manifest from './dist/routes.json';
import config from './transclude.config.js';

export default workerFrom({ config, manifest, entry, bundle });
