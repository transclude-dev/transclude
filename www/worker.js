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
import { hold } from './app/lib/bindings.js';

const inner = workerFrom({ config, manifest, entry, bundle });

// `hold` before the request goes in, because a loader reaching a binding asks
// for `env` and `ctx` has none. Outside any memoisation, since the app is built
// once and this is free to repeat. Nothing here reaches one today; the bridge
// stays because it is what /docs/runtimes tells an app to write.
export default {
  fetch(request, env, ctx) {
    hold(env);
    return inner.fetch(request, env, ctx);
  },
};
