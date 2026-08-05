// What this site is documentation of.
//
// `bin/release.js` writes the version into `package.json` and commits it, and
// the site deploys on every push to main. So between releases the manifest still
// names the last release while these pages describe work nobody can install.
// The number on its own would say the wrong thing for most of the time it is
// shown, which is worse than saying nothing: the gap has already spanned a
// breaking change more than once.
//
// So the footer says which of the two it is, and the build works it out rather
// than anyone remembering to.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// www/app/lib -> www/app -> www -> the repository.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const git = (...args) =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();

/** The version both packages carry, which `bin/release.js` is the only writer of. */
export const version = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
).version;

/**
 * Whether this build is the commit that was tagged for that version.
 *
 * Unknown counts as ahead. The way to not know is a checkout with no tags,
 * which is what CI does unless asked otherwise, and being wrong in that
 * direction only says the pages may run ahead of the release. Wrong the other
 * way is the site claiming to document a version you can install when it does
 * not.
 */
export const released = (() => {
  try {
    return git('rev-parse', '--verify', `v${version}^{commit}`) === git('rev-parse', 'HEAD');
  } catch {
    return false;
  }
})();

const RELEASES = 'https://github.com/transclude-dev/transclude/releases';

/** Where the footer's version links: the release itself, or the list of them. */
export const versionHref = released ? `${RELEASES}/tag/v${version}` : RELEASES;

/** `v0.6.0`, or `after v0.6.0` when the pages describe more than that release. */
export const versionLabel = released ? `v${version}` : `after v${version}`;
