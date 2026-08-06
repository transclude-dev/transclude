// Cloudflare Workers entry for this site. `npm run deploy` sends it.
//
// This file belongs to the site rather than to the framework, because every
// import in it names something the site owns. A bundler needs a literal path to
// follow, so the imports stay here. The wiring behind `workerFrom` does not.
//
// The site is served by a worker rather than as a directory of files, and the
// landing page is why: it says a fragment is a URL and links to one, and
// `/?fragment=demo` is a render. A static host matches on path and ignores the
// query, so it would answer that link with the whole document and make the page
// a liar.
//
// The cost of having no filesystem is that the assets travel in the bundle.
// Plain bytes only, and the platform compresses on the way out.

import { workerFrom } from '@transclude/core/worker';
import * as bundle from './dist/server/assets.js';
import * as entry from './dist/server/entry.js';
import manifest from './dist/routes.json';
import config from './transclude.config.js';

export default workerFrom({ config, manifest, entry, bundle });
