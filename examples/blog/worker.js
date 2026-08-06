// Cloudflare Workers entry for this example. `npm run deploy` sends it.
//
// This file belongs to the app, because every import in it names something the
// app owns. A bundler needs a literal path to follow, so the imports cannot move
// into the package. The wiring behind `workerFrom` can, and has.

import { workerFrom } from '@transclude/core/worker';
import * as bundle from './dist/server/assets.js';
import * as entry from './dist/server/entry.js';
import manifest from './dist/routes.json';
import config from './transclude.config.js';

export default workerFrom({ config, manifest, entry, bundle });
