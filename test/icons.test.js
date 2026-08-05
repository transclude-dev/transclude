// The sprite the build writes, and what it refuses.
//
// The sprite is served as `image/svg+xml`, which a browser parses as XML rather
// than HTML. XML has no void elements and no unquoted attributes, so a
// serializer that takes an HTML shortcut anywhere in here produces a file that
// fails to parse as a whole and takes every icon down with it.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildSprite,
  DEFAULT_LIBRARY,
  readLibraries,
  refuseSpriteClash,
  spritePath,
} from '../src/icons.js';

/** A directory tree from `{ 'ui/check.svg': '<svg…>' }`. */
function tree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-icons-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return dir;
}

const icon = (id, svg) => ({ id, file: `app/icons/${id}.svg`, svg });

const CHECK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path d="M4 12l6 6L20 6"/></svg>';

test('a directory of files becomes one document of symbols', () => {
  const sprite = buildSprite([icon('check', CHECK)]);

  assert.match(sprite, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg">/);
  assert.match(sprite, /<symbol id="check"/);
  assert.match(sprite, /<path d="M4 12l6 6L20 6"><\/path>/);
  assert.match(sprite, /<\/svg>$/);
});

test('a library is served at the root, under the name of its directory', () => {
  assert.equal(spritePath(DEFAULT_LIBRARY), '/icons.svg');
  assert.equal(spritePath('lucide'), '/lucide.svg');
});

test('viewBox is kept and width and height are dropped', () => {
  const sprite = buildSprite([icon('check', CHECK)]);

  assert.match(sprite, /viewBox="0 0 24 24"/);
  assert.doesNotMatch(sprite, /width=/);
  assert.doesNotMatch(sprite, /height=/);
});

test('presentation attributes on the root survive', () => {
  // How most icon sets say what they are. Dropping these turns every icon into
  // a black blob, which renders and looks like a stylesheet problem.
  const lucide =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/></svg>';

  const sprite = buildSprite([icon('minus', lucide)]);

  assert.match(sprite, /fill="none"/);
  assert.match(sprite, /stroke="currentColor"/);
  assert.match(sprite, /stroke-width="2"/);
  assert.match(sprite, /stroke-linecap="round"/);
});

test("the file's own id and accessibility attributes do not survive", () => {
  // The symbol is named by its file, and a second id inside would answer to a
  // `<use href>` nobody wrote. A label belongs on the use site, which is the
  // only place that knows what the icon means there.
  const labelled =
    '<svg viewBox="0 0 24 24" id="logo" role="img" aria-label="Home">' +
    '<title>Home</title><path d="M4 12h16"/></svg>';

  const sprite = buildSprite([icon('home', labelled)]);

  assert.match(sprite, /<symbol id="home"/);
  assert.doesNotMatch(sprite, /id="logo"/);
  assert.doesNotMatch(sprite, /role="img"/);
  assert.doesNotMatch(sprite, /aria-label/);
});

test('every element closes, so the sprite parses as XML', () => {
  // `<image>` and `<use>` are void elements in HTML and are not in SVG. A
  // serializer that decides by tag name rather than by namespace emits
  // `<image>` with no closing tag, and the whole document fails to parse.
  const embedded =
    '<svg viewBox="0 0 24 24"><image href="/a.png" width="24" height="24"/>' +
    '<use href="#other"/><circle cx="12" cy="12" r="4"/></svg>';

  const sprite = buildSprite([icon('photo', embedded)]);

  assert.match(sprite, /<image [^>]*><\/image>/);
  assert.match(sprite, /<use [^>]*><\/use>/);
  assert.match(sprite, /<circle [^>]*><\/circle>/);
});

test('an ampersand in an attribute is escaped, which XML requires', () => {
  const query = '<svg viewBox="0 0 24 24"><image href="/a.png?w=1&h=2"/></svg>';

  const sprite = buildSprite([icon('query', query)]);

  assert.match(sprite, /w=1&amp;h=2/);
  assert.doesNotMatch(sprite, /w=1&h=2/);
});

test('nested markup is carried over whole', () => {
  const grouped =
    '<svg viewBox="0 0 24 24"><g fill="red"><path d="M0 0h4v4H0z"/>' +
    '<path d="M8 8h4v4H8z"/></g></svg>';

  const sprite = buildSprite([icon('squares', grouped)]);

  assert.match(sprite, /<g fill="red"><path d="M0 0h4v4H0z"><\/path><path/);
});

test('a file with no viewBox is refused, and the message names it', () => {
  const bare = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path d="M0 0"/></svg>';

  assert.throws(() => buildSprite([icon('bare', bare)]), (error) => {
    assert.match(error.message, /app\/icons\/bare\.svg/);
    assert.match(error.message, /viewBox/);
    return true;
  });
});

test('a file that is not an SVG is refused', () => {
  assert.throws(
    () => buildSprite([icon('notes', '<html><body><p>not an icon</p></body></html>')]),
    /app\/icons\/notes\.svg has no <svg>/,
  );
});

test('two files claiming one name are refused, and the message names both', () => {
  const first = { id: 'check', file: 'app/icons/ui/check.svg', svg: CHECK };
  const second = { id: 'check', file: 'app/icons/nav/check.svg', svg: CHECK };

  assert.throws(() => buildSprite([first, second]), (error) => {
    assert.match(error.message, /ui\/check\.svg/);
    assert.match(error.message, /nav\/check\.svg/);
    return true;
  });
});

test('two builds of one directory agree, whatever order the files arrive in', () => {
  // The sprite keeps a stable URL and different bytes between builds, so its
  // ETag is what tells a cache it changed. Ordering that follows the filesystem
  // would change the bytes without changing an icon.
  const a = icon('alpha', CHECK);
  const b = icon('beta', CHECK);

  assert.equal(buildSprite([a, b]), buildSprite([b, a]));
});

test('no icons is an empty sprite rather than an error', () => {
  assert.equal(buildSprite([]), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
});

// ---- libraries -------------------------------------------------------------

test('loose files at the top are the default library', () => {
  const dir = tree({ 'check.svg': CHECK, 'chevron-down.svg': CHECK });
  const libraries = readLibraries(dir);

  assert.deepEqual(libraries.map((l) => l.name), [DEFAULT_LIBRARY]);
  assert.deepEqual(libraries[0].icons.map((i) => i.id).sort(), ['check', 'chevron-down']);
});

test('a subdirectory is a library named after it', () => {
  // The case people arrive with: an icon set downloaded as a folder, put here
  // whole. Nothing was renamed to get `/lucide.svg#check`.
  const dir = tree({ 'lucide/check.svg': CHECK, 'lucide/arrow-right.svg': CHECK });
  const libraries = readLibraries(dir);

  assert.deepEqual(libraries.map((l) => l.name), ['lucide']);
  assert.equal(libraries[0].icons.length, 2);
});

test('loose files and libraries live together', () => {
  const dir = tree({
    'check.svg': CHECK,
    'lucide/star.svg': CHECK,
    'glyphicons/star.svg': CHECK,
  });

  assert.deepEqual(readLibraries(dir).map((l) => l.name), ['glyphicons', 'icons', 'lucide']);
});

test('one name in two libraries is two icons, not a collision', () => {
  // What the flat reading could not do. Both are `#star`, in different sheets.
  const dir = tree({ 'lucide/star.svg': CHECK, 'glyphicons/star.svg': CHECK });
  const libraries = readLibraries(dir);

  for (const library of libraries) {
    assert.deepEqual(library.icons.map((i) => i.id), ['star']);
  }
});

test('a directory inside a library is refused, and the message names it', () => {
  // Flattening would give two files one id and skipping loses icons silently.
  const dir = tree({ 'lucide/arrows/up.svg': CHECK });

  assert.throws(() => readLibraries(dir), (error) => {
    assert.match(error.message, /arrows/);
    assert.match(error.message, /one flat directory/);
    return true;
  });
});

test('an empty directory is not a library', () => {
  const dir = tree({ 'lucide/README.md': 'not an icon', 'check.svg': CHECK });

  assert.deepEqual(readLibraries(dir).map((l) => l.name), [DEFAULT_LIBRARY]);
});

test('a missing directory reads as no libraries rather than throwing', () => {
  assert.deepEqual(readLibraries(path.join(os.tmpdir(), 'tc-icons-does-not-exist')), []);
});

test('libraries come back sorted, so two builds of one tree agree', () => {
  const dir = tree({ 'zeta/a.svg': CHECK, 'alpha/a.svg': CHECK, 'mid/a.svg': CHECK });

  assert.deepEqual(readLibraries(dir).map((l) => l.name), ['alpha', 'mid', 'zeta']);
});

test('the reported file is relative to the root it was given', () => {
  const dir = tree({ 'lucide/check.svg': CHECK });
  const [library] = readLibraries(dir);

  assert.equal(library.icons[0].file, path.join('lucide', 'check.svg'));
});

// ---- one thing answers for one URL -----------------------------------------

test('a public file at a library URL is refused, because the servers disagree', () => {
  // The build copies the public directory and writes the sprite over it; dev
  // asks the public handler first and never reaches the sprite. Same two files,
  // opposite winners, so neither server picks.
  const dir = tree({ 'lucide.svg': '<svg></svg>' });

  assert.throws(() => refuseSpriteClash(dir, [{ name: 'lucide' }]), (error) => {
    assert.match(error.message, /lucide\.svg/);
    assert.match(error.message, /rename the public file/);
    return true;
  });
});

test('every library is checked, not only the default one', () => {
  // The set of URLs this claims grows with the author's tree.
  const dir = tree({ 'glyphicons.svg': '<svg></svg>' });

  assert.throws(
    () => refuseSpriteClash(dir, [{ name: 'icons' }, { name: 'glyphicons' }]),
    /glyphicons/,
  );
});

test('no public directory and no clashing file are both fine', () => {
  assert.doesNotThrow(() => refuseSpriteClash(null, [{ name: 'icons' }]));
  assert.doesNotThrow(() => refuseSpriteClash(tree({ 'robots.txt': '' }), [{ name: 'icons' }]));
});
