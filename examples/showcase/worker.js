// Cloudflare Workers entry for this app. `npm run start:worker`
//
// This file is the app's, not the framework's, because every import in it names
// something the app owns: its build output and its config. A bundler needs a
// literal path to follow, so those cannot move into the package. The wiring
// behind `workerFrom` can, and did.
//
// The cost of having no filesystem is that the assets are in the bundle. Plain
// bytes only, and the platform compresses on the way out.

import { workerFrom } from '@transclude/core/worker';
import * as bundle from './dist/server/assets.js';
import * as entry from './dist/server/entry.js';
import manifest from './dist/routes.json';
import config from './transclude.config.js';

// `cookieSecret` comes from `env.COOKIE_SECRET`, which arrives with the first
// request. There is no `process.env` on this runtime, so a secret read at import
// time would be undefined and signing would refuse.
export default workerFrom({ config, manifest, entry, bundle });
