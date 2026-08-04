// Contrast, in APCA rather than in WCAG ratios.
//
// The two disagree most on dark themes: a pairing that clears WCAG AA can sit
// near Lc 40, which is not readable. Every color the site ships is checked
// here against the background it is actually used on, so a palette change that
// looks fine cannot quietly drop below the floor.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.join(root, '..', 'app', 'styles', 'global.css'), 'utf8');

/**
 * APCA 0.1.9. Luminance uses a plain 2.4 power rather than the piecewise sRGB
 * curve, which is what the algorithm specifies.
 */
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const y = 0.2126729 * r ** 2.4 + 0.7151522 * g ** 2.4 + 0.072175 * b ** 2.4;
  // Black levels are softly clamped, or near-black pairs read as more
  // contrasting than they look.
  return y < 0.022 ? y + (0.022 - y) ** 1.414 : y;
}

/** Lc, unsigned. Polarity changes the exponents, not the meaning. */
function contrast(text, background) {
  const t = luminance(text);
  const b = luminance(background);

  if (b > t) {
    const s = (b ** 0.56 - t ** 0.57) * 1.14;
    return s < 0.1 ? 0 : (s - 0.027) * 100;
  }
  const s = (b ** 0.65 - t ** 0.62) * 1.14;
  return s > -0.1 ? 0 : Math.abs((s + 0.027) * 100);
}

/** Reads a token out of the stylesheet, from the light or the dark block. */
function token(name, theme) {
  const dark = css.slice(css.indexOf('prefers-color-scheme: dark'));
  const source = theme === 'dark' ? dark : css.slice(0, css.indexOf('prefers-color-scheme: dark'));
  const found = source.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i'));

  assert.ok(found, `--${name} not found in the ${theme} palette`);
  return found[1];
}

// Body text wants 90, everything else that is read wants 75, and code tokens
// want 60. These are the APCA levels, not ones invented here.
const PAIRS = [
  ['body text', 'ink', 'ground', 90],
  ['code text', 'ink', 'sunken', 90],
  ['note text', 'ink', 'note-bg', 90],
  ['muted prose', 'muted', 'ground', 75],
  ['muted on surface', 'muted', 'surface', 75],
  ['muted in code', 'muted', 'sunken', 75],
  ['link', 'link', 'ground', 75],
  ['link on surface', 'link', 'surface', 75],
  ['link in code', 'link', 'sunken', 75],
  ['note label', 'link', 'note-bg', 75],
  ['warn label', 'warn-ink', 'warn-bg', 75],
];

for (const theme of ['light', 'dark']) {
  test(`every ${theme} pairing clears its APCA level`, () => {
    const low = [];

    for (const [what, fg, bg, need] of PAIRS) {
      const lc = contrast(token(fg, theme), token(bg, theme));
      if (lc < need) low.push(`${what}: Lc ${lc.toFixed(1)}, needs ${need}`);
    }

    assert.deepEqual(low, []);
  });
}

test('the syntax themes are the high-contrast pair', () => {
  // github-dark's comment token reads Lc 28 on this background, which is under
  // the floor for code and well under it for a comment worth reading.
  const source = fs.readFileSync(path.join(root, '..', 'app', 'lib', 'code.js'), 'utf8');
  assert.match(source, /github-light-high-contrast/);
  assert.match(source, /github-dark-high-contrast/);
});

test('a pairing known to be bad is still measured as bad', () => {
  // Falsifies the check itself. These were the shipped values before APCA was
  // run over them, and both were comfortably under.
  assert.ok(contrast('#8d8da1', '#0b0b0f') < 50, 'the old dark muted should fail');
  assert.ok(contrast('#7b96ff', '#0b0b0f') < 60, 'the old dark link should fail');
});
