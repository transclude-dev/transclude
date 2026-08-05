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

import { buildSprite, readIcons, refuseSpriteClash, SPRITE_PATH } from '../src/icons.js';

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

test('the sprite is served at a fixed path, because <use href> is written by hand', () => {
  assert.equal(SPRITE_PATH, '/icons.svg');
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

// ---- reading the directory -------------------------------------------------

test('every .svg is read, nested ones included, and nothing else is', () => {
  const dir = tree({
    'check.svg': CHECK,
    'nav/chevron-down.svg': CHECK,
    'README.md': '# icons',
    '.DS_Store': 'junk',
  });

  const icons = readIcons(dir).map((icon) => icon.id).sort();
  assert.deepEqual(icons, ['check', 'chevron-down']);
});

test('a missing directory reads as no icons rather than throwing', () => {
  assert.deepEqual(readIcons(path.join(os.tmpdir(), 'tc-icons-does-not-exist')), []);
});

test('the reported file is relative to the root it was given', () => {
  const dir = tree({ 'nav/check.svg': CHECK });
  const [icon] = readIcons(path.join(dir, 'nav'), dir);

  assert.equal(icon.file, path.join('nav', 'check.svg'));
});

// ---- one thing answers for one URL -----------------------------------------

test('a public file at the sprite URL is refused, because the servers disagree', () => {
  // The build copies the public directory and writes the sprite over it; dev
  // asks the public handler first and never reaches the sprite. Same two files,
  // opposite winners, so neither server picks.
  const dir = tree({ 'icons.svg': '<svg></svg>' });

  assert.throws(() => refuseSpriteClash(dir), (error) => {
    assert.match(error.message, /icons\.svg/);
    assert.match(error.message, /rename the public file/);
    return true;
  });
});

test('no public directory and no clashing file are both fine', () => {
  assert.doesNotThrow(() => refuseSpriteClash(null));
  assert.doesNotThrow(() => refuseSpriteClash(tree({ 'robots.txt': '' })));
});
