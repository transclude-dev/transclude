// Copies htmx out of node_modules and into the files this site serves.
//
// It is not fetched from a CDN, and that is the point rather than a preference.
// This app sets `csp: true`, so the policy is `script-src 'self'` and a script
// from anywhere else is refused by the browser with nothing on the page to say
// why. Serving it from `app/public/` makes it 'self'.
//
// The copy is gitignored: the version in package.json is the record, and
// `prebuild` and `predev` put it back.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const from = path.join(root, 'node_modules', 'htmx.org', 'dist', 'htmx.min.js');
const to = path.join(root, 'app', 'public', 'htmx.min.js');

if (!fs.existsSync(from)) {
  throw new Error(`[vendor] ${path.relative(root, from)} is missing. Run npm install.`);
}

fs.mkdirSync(path.dirname(to), { recursive: true });
fs.copyFileSync(from, to);

const { version } = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', 'htmx.org', 'package.json'), 'utf8'));
console.log(`htmx ${version} -> app/public/htmx.min.js`);
