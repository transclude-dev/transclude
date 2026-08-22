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

describe('a stage link lands on a line that is there', async () => {
  // The line comes from finding the symbol at build time and the id comes from
  // rendering the listing, and they are written in different files. An anchor
  // that names an id nothing rendered does not fail: the browser opens the
  // page at the top and the reader assumes that is the line.
  const wanted = [...explorer().matchAll(/href="(\/source\/src\/[^"#]+)#(L\d+)"/g)];
  const wrong = [];
  for (const [, href, id] of wanted) {
    const { body } = await ask(href);
    if (!body.includes(`id="${id}"`)) wrong.push(`${href}#${id}`);
  }

  assert.ok(wanted.length >= 20, `only ${wanted.length} stage links`);
  assert.deepEqual(wrong, [], 'a stage link names a line the page never rendered');
});

describe('a module page points into itself, not back at a heading', async () => {
  // The loader hands this page the symbol and the line for every stage that
  // names it. They used to link to `/explorer#stages`, which is the compile
  // section and wrong for the request ones, and jumped into no file at all.
  const { body } = await ask('/source/src/document.js');
  const inside = body.slice(body.indexOf('<ul class="source-in"'), body.indexOf('</ul>'));

  const anchors = [...inside.matchAll(/href="#(L\d+)"/g)].map(([, id]) => id);
  assert.ok(anchors.length >= 5, `only ${anchors.length} stage references on document.js`);
  for (const id of anchors) {
    assert.ok(body.includes(`id="${id}"`), `${id} is named but never rendered`);
  }
  assert.doesNotMatch(inside, /explorer#stages/, 'a stage reference points at the wrong section');
});

describe('a linked line can be seen when the browser lands on it', () => {
  // Without a scroll margin the line sits against the top of the viewport with
  // nothing above it, and without a rule of its own it is one of seven hundred
  // that all look the same.
  const css = fs.readFileSync(path.join(root, 'app', 'styles', 'global.css'), 'utf8');

  assert.match(css, /\.listing \.row\s*\{[^}]*scroll-margin-top/, 'a linked line lands flush against the top');
  assert.match(css, /\.listing \.row:target\s*\{/, 'a linked line is not marked');
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

describe('the explorer points at a fragment a reader can open', async () => {
  // The page marks its code as a fragment and nothing on the site swaps one
  // in, which is the framework's own position. So the explorer names the URL
  // instead, and it has to answer.
  assert.match(explorer(), /\?fragment=code/, 'nothing points at the fragment');

  const { status, body } = await ask('/source/src/document.js?fragment=code');
  assert.equal(status, 200);
  assert.match(body, /id="code"/);
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

  // Reading a module is a navigation, the same as every stage link. Nothing
  // fetches it, so nothing has to be wired up for the link to work.
  assert.doesNotMatch(html, /fetch\(/, 'the page fetches something it could have linked to');
  assert.doesNotMatch(html, /<dialog/, 'a dialog is back');
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
