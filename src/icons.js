// A directory of SVG files, as one sprite.
//
// An icon stays a file the author manages: `app/icons/check.svg` is a whole SVG
// document they can open, edit and diff. What a browser wants is the other
// shape, one file of `<symbol>`s, so `<use href="/icons.svg#check">` costs one
// cached request however many icons a page shows.
//
// Build-time only, like `public-files.js` and outside the portable core: the
// sprite is bytes on disk by the time any server answers for it. `buildSprite`
// takes contents rather than a directory anyway, so the half that decides what
// the markup is can be tested without fixtures.
//
// The dev server and the build both call `readIcons` then `buildSprite`. They
// used to be the same two lines written twice, which is how `/icons.svg` served
// in production and 404'd in dev.

import fs from 'node:fs';
import path from 'node:path';
import { parse, serializeOuter } from 'parse5';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Where the sprite is served. Fixed, because `<use href>` is written by hand. */
export const SPRITE_PATH = '/icons.svg';

/**
 * Root attributes that must not survive into a `<symbol>`.
 *
 * `width` and `height` are the ones that matter: an icon file carries them so it
 * renders on its own, and inside a sprite they fight whatever CSS sizes the
 * `<use>`. Everything else here would be a second element's identity or a
 * document's namespace, neither of which means anything on a symbol.
 *
 * Presentation attributes are deliberately not listed. `fill="none"
 * stroke="currentColor"` on the root is how most icon sets say what they are,
 * and dropping those turns every icon into a black blob.
 */
const DROPPED = new Set(['width', 'height', 'xmlns', 'xmlns:xlink', 'version', 'id', 'role']);

const kept = (attr) => !DROPPED.has(attr.name) && !attr.name.startsWith('aria-');

/** The `<svg>` a file starts with, or null. Parsed as HTML, which is where SVG lives. */
function rootSvgOf(source) {
  const find = (node) => {
    for (const child of node.childNodes ?? []) {
      if (child.tagName === 'svg' && child.namespaceURI === SVG_NS) return child;
      const found = find(child);
      if (found) return found;
    }
    return null;
  };
  return find(parse(source));
}

/**
 * One file as one `<symbol>`.
 *
 * The parsed node is renamed and re-serialized rather than rebuilt from strings.
 * parse5 already knows how to escape an attribute value and which SVG attributes
 * keep their capitals, and a second hand-written serializer here would get
 * `viewBox` wrong first.
 *
 * @param {{ id: string, file: string, svg: string }} icon
 * @returns {string}
 * @throws when the file is not an SVG, or has no `viewBox`
 */
function symbolFor({ id, file, svg }) {
  const root = rootSvgOf(svg);
  if (!root) {
    throw new Error(`[transclude] ${file} has no <svg> in it, so it is not an icon.`);
  }

  // Refused rather than warned. Without a viewBox the symbol has no coordinate
  // system to scale into, so the icon renders at some other size and nothing
  // says why. That is the failure this check exists for.
  const viewBox = root.attrs.find((attr) => attr.name === 'viewBox');
  if (!viewBox) {
    throw new Error(
      `[transclude] ${file} has no viewBox. A symbol scales by its viewBox, so ` +
        `without one the icon renders at the wrong size and says nothing. ` +
        `Add viewBox="0 0 24 24", with the numbers the artwork was drawn at.`,
    );
  }

  root.tagName = 'symbol';
  root.nodeName = 'symbol';
  root.attrs = [{ name: 'id', value: id }, ...root.attrs.filter(kept)];

  return serializeOuter(root);
}

/**
 * Every icon as one SVG document.
 *
 * Sorted by id, so two builds of the same directory produce the same bytes and
 * an ETag means what it says.
 *
 * @param {Array<{ id: string, file: string, svg: string }>} icons
 * @returns {string} an SVG document of `<symbol>`s
 * @throws when two files claim one id
 */
export function buildSprite(icons) {
  const byId = new Map();
  for (const icon of icons) {
    const first = byId.get(icon.id);
    if (first) {
      throw new Error(
        `[transclude] ${first.file} and ${icon.file} would both be #${icon.id}. ` +
          `An icon is named by its file, so two files cannot share a name even in ` +
          `different directories. Rename one.`,
      );
    }
    byId.set(icon.id, icon);
  }

  const sorted = [...icons].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const symbols = sorted.map(symbolFor).join('');

  // No `display:none` and no `<defs>`. A `<symbol>` renders nothing on its own,
  // which is the whole reason the sprite is symbols rather than groups.
  return `<svg xmlns="${SVG_NS}">${symbols}</svg>`;
}

/**
 * Refuses a hand-written public file at the sprite's URL.
 *
 * Two things would answer for `/icons.svg`, and the two servers pick different
 * winners: the build copies the public directory first and writes the sprite
 * over it, while dev asks the public handler first and never reaches the sprite.
 * Rather than pick one, neither runs until the author has.
 *
 * @param {string|null} publicDir the author's public directory, not the copy
 * @throws when a file already sits at the sprite's URL
 */
export function refuseSpriteClash(publicDir) {
  if (!publicDir) return;

  const clash = path.join(publicDir, path.basename(SPRITE_PATH));
  if (!fs.existsSync(clash)) return;

  throw new Error(
    `[transclude] ${clash} and the icons directory both answer for ${SPRITE_PATH}. ` +
      `The sprite is built from the icons, so rename the public file or delete it.`,
  );
}

/**
 * Every `.svg` under `dir`, ready for `buildSprite`.
 *
 * Nested directories are read, and an icon is still named by its file alone, so
 * `ui/check.svg` and `nav/check.svg` collide. `buildSprite` says so by name.
 * Sorting is left to it, so one directory reads the same on any filesystem.
 *
 * @param {string} dir
 * @param {string} [root] what the reported file paths are relative to
 * @returns {Array<{ id: string, file: string, svg: string }>} empty if `dir` is absent
 */
export function readIcons(dir, root = dir) {
  if (!fs.existsSync(dir)) return [];

  const icons = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) icons.push(...readIcons(full, root));
    else if (entry.name.endsWith('.svg')) {
      icons.push({
        id: path.basename(entry.name, '.svg'),
        file: path.relative(root, full),
        svg: fs.readFileSync(full, 'utf8'),
      });
    }
  }
  return icons;
}
