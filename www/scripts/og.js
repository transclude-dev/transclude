#!/usr/bin/env node
// Renders the sharing image.
//
//   npm run og
//
// `scripts/og-card.html` is the design and this turns it into
// `app/public/og.png` at 1200x630, which is the size every platform crops from.
//
// Headless Chrome rather than a rasteriser, because the card is a web page: it
// uses the site's own two typefaces and its own colors, and anything that could
// render it correctly is a browser. The alternative was a native image library
// as a dependency of a site that has two.
//
// Run by hand rather than on every build. The image changes when the design
// does, which is rarely, and a build that shells out to a browser is a build
// that fails on a machine without one.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((at) => fs.existsSync(at));

if (!CHROME) {
  process.stderr.write('\nNo Chrome or Chromium found, and the card is a web page.\n\n');
  process.exit(1);
}

const card = path.join(here, 'og-card.html');
const out = path.join(root, 'app/public/og.png');

// Chrome writes to the working directory under a name it chooses, so it runs
// somewhere disposable and the file is moved into place afterwards.
const scratch = fs.mkdtempSync(path.join(root, 'dist/.og-'));

execFileSync(
  CHROME,
  [
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--window-size=1200,630',
    `--screenshot=${path.join(scratch, 'og.png')}`,
    // Fonts load from disk, which a file: page is not allowed to do otherwise.
    '--allow-file-access-from-files',
    `file://${card}`,
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.renameSync(path.join(scratch, 'og.png'), out);
fs.rmSync(scratch, { recursive: true, force: true });

const { size } = fs.statSync(out);
process.stdout.write(`\n  Wrote ${path.relative(root, out)}, ${(size / 1024).toFixed(1)} KB\n\n`);
