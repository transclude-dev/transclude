// The explorer, and the page each module gets.
//
// It replaced a 4.5 MB static file. The point of the change is that a reader
// downloads the story and then only the modules they open, so what is worth
// pinning is that the split holds: every link resolves, every fragment is the
// piece of the page it claims to be, and none of it needs JavaScript to read.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist', 'static');

// These read what `npm run build` wrote, and skip without one, like the rest.
const describe = fs.existsSync(path.join(dist, 'explorer', 'index.html')) ? test : test.skip;

const built = (route) => fs.readFileSync(path.join(dist, route.slice(1), 'index.html'), 'utf8');
const explorer = () => built('/explorer');

/**
 * The built app, asked for a URL.
 *
 * A module page is rendered when it is asked for rather than written to a
 * file, so the filesystem is the wrong place to look for one. This is the same
 * app `npm start` serves, which is what `/docs/testing` recommends asking.
 */
let served = null;
async function ask(url) {
  served ??= await import('@transclude/core/production');
  const out = await served.app.request(`http://x${url}`);
  return { status: out.status, body: await out.text() };
}

/** Every .js file under src/, which is what the explorer claims to cover. */
function sources() {
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith('.js')) found.push(path.relative(path.join(root, '..'), file));
    }
  };
  walk(path.join(root, '..', 'src'));
  return found.sort();
}

describe('every module in src/ is a page, and the explorer links to all of them', () => {
  // Two lists that drift apart silently: a file added to src/ and not to the
  // index reads as a complete map that is missing something.
  const listed = [...explorer().matchAll(/data-file="(src\/[^"]+)"/g)].map(([, f]) => f).sort();

  assert.deepEqual(listed, sources());
});

describe('no group on the index is empty', () => {
  // A file that stops matching its group falls through to "the rest", so
  // nothing is lost and nothing fails. What is left behind is a heading with
  // an empty list under it, which reads as a section still to be written.
  const lists = [...explorer().matchAll(/<ul class="x-files">([\s\S]*?)<\/ul>/g)].map(([, body]) => body);

  assert.ok(lists.length >= 4, `only ${lists.length} groups rendered`);
  assert.deepEqual(
    lists.filter((body) => !body.includes('data-file=')).length,
    0,
    'a group heading has no modules under it',
  );
});

describe('every page the explorer links to answers', async () => {
  const wanted = [...new Set([...explorer().matchAll(/href="(\/source\/[^"#]+)/g)].map(([, h]) => h))];
  const missing = [];
  for (const href of wanted) {
    const { status } = await ask(href);
    if (status !== 200) missing.push(`${href} answered ${status}`);
  }

  assert.ok(wanted.length >= 48, `only ${wanted.length} module links on the page`);
  assert.deepEqual(missing, [], 'the explorer links somewhere that does not answer');
});

describe('a name that is not a module is a 404, not an empty page', async () => {
  const { status, body } = await ask('/source/src/nope.js');

  assert.equal(status, 404);
  assert.match(body, /No file by that name/);
});

describe('every module URL is in the sitemap', () => {
  // The one job `paths()` still has. Without `prerender` it names no files, so
  // deleting it would change nothing a reader can see and quietly drop 48
  // pages out of the index.
  const map = fs.readFileSync(path.join(dist, 'sitemap.xml'), 'utf8');
  const listed = [...map.matchAll(/<loc>[^<]*\/source\/(src\/[^<]+)<\/loc>/g)].map(([, f]) => f).sort();

  assert.deepEqual(listed, sources());
});

describe('a stage link points at a line its file has', () => {
  // The line comes from finding the symbol at build time. If it ran past the
  // end of the file the anchor would simply do nothing, which is the quiet
  // kind of wrong.
  const short = [];
  for (const [, file, line] of explorer().matchAll(/href="\/source\/(src\/[^"#]+)#L(\d+)"/g)) {
    const rows = fs.readFileSync(path.join(root, '..', file), 'utf8').split('\n').length;
    if (Number(line) > rows) short.push(`${file}:${line} of ${rows}`);
  }

  assert.deepEqual(short, [], 'a stage points past the end of its file');
});

describe('a module page carries its code as a fragment of itself', async () => {
  // The claim the whole site is about. `?fragment=code` has to be the markup
  // the page already holds, not a second render of the same thing.
  const { body: page } = await ask('/source/src/document.js');
  const { body: piece } = await ask('/source/src/document.js?fragment=code');

  assert.match(page, /--shiki-light/, 'the code is not highlighted');
  assert.ok(page.includes(piece.trim()), 'the fragment is not part of its own page');
  assert.ok(piece.length < page.length, 'the fragment is the whole page');

  // Every line numbered, and the count is the file's own. Trimmed, because a
  // file ends with a newline and the empty string after it is not a line
  // anybody wrote.
  const rows = (piece.match(/class="row"/g) ?? []).length;
  const source = fs.readFileSync(path.join(root, '..', 'src', 'document.js'), 'utf8');
  assert.equal(rows, source.trim().split('\n').length, 'the page and the file disagree about how many lines there are');
});

describe('a swapped-in listing brings nothing it needs', async () => {
  // The bug this exists for. `.listing` and `.row` used to live in the source
  // page's own <style>, which is hoisted into that page's head and does not
  // travel with a fragment. The explorer swapped one in and got 700 lines run
  // together on one line, with no error anywhere.
  const { body: piece } = await ask('/source/src/after.js?fragment=code');
  const stylesheet = fs.readFileSync(path.join(root, 'app', 'styles', 'global.css'), 'utf8');

  assert.doesNotMatch(piece, /<style/, 'the fragment carries styles, so it cannot be the page that holds them');
  // Matched to where the selector ends, because `.listing .row` is a substring
  // of `.listing .rowX` and a renamed rule would otherwise still look present.
  for (const rule of ['.listing', '.listing .row', '.listing .no']) {
    const declared = new RegExp(rule.replace(/\./g, '\\.') + '\\s*[,{]');
    assert.match(stylesheet, declared, `${rule} is not in the stylesheet, so a swapped-in listing has no layout`);
  }
});

describe('a listing takes its colors from the token rule', async () => {
  // Shiki writes both themes onto every token and sets no color itself, and
  // the stylesheet picks with `.shiki span`. Without that class on the block
  // the code renders in one flat color and still looks deliberate.
  const { body: piece } = await ask('/source/src/after.js?fragment=code');

  assert.match(piece, /<pre class="shiki"/, 'the block is not marked for the token rule');
  assert.match(piece, /--shiki-light/, 'the tokens carry no theme');
});

describe('the explorer reads without JavaScript', () => {
  const html = explorer();

  // The module index is links, not buttons. Turn the script off and every one
  // of them still goes somewhere.
  assert.match(html, /<a href="\/source\/src\/[^"]+" data-file=/);
  // The panes are server-rendered, so the story is there before anything runs.
  assert.ok((html.match(/class="x-line"/g) ?? []).length > 100, 'the panes are not rendered');
  // One bundled module, and no inline script of this page's own.
  assert.match(html, /<script type="module" src="\/assets\/explorer-[^"]+\.js">/);
});

describe('nothing on the explorer rendered a value that was not there', () => {
  const text = explorer().replace(/<[^>]*>/g, ' ');

  assert.doesNotMatch(text, /\bundefined\b/);
  assert.doesNotMatch(text, /\bNaN\b/);
  assert.doesNotMatch(text, /\[object Object\]/);
});

describe('the shared-line count on the page is the one the build measured', async () => {
  const { shared } = await import('../app/lib/source.js');

  assert.match(explorer(), new RegExp(`${shared} of those lines are identical`));
});
