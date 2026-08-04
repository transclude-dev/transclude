// The site's own checks. They read the built output, so `npm run build` has to
// have run first.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// `fileURLToPath`, not `url.pathname`: a space in the project path stays
// percent-encoded in the second one.
const root = path.dirname(fileURLToPath(import.meta.url));
const routes = path.join(root, '..', 'app', 'routes');

// The docs live under /docs so the landing page can own / and not inherit their
// shell. The nav, the pager and these tests all read from the same place.
const docs = path.join(routes, 'docs');

/** Every page the nav claims to link to. */
function navLinks() {
  const layout = fs.readFileSync(path.join(docs, '_layout.html'), 'utf8');
  return [...layout.matchAll(/href:\s*'([^']+)'/g)].map(([, href]) => href);
}

/** The file behind a URL the nav names. */
function pageFor(href) {
  const rel = href === '/docs' ? 'index' : href.replace(/^\/docs\//, '');
  return path.join(docs, `${rel}.html`);
}

test('every nav link has a page behind it', () => {
  const missing = navLinks().filter((href) => !fs.existsSync(pageFor(href)));

  assert.deepEqual(missing, [], `nav links with no page: ${missing.join(', ')}`);
});

test('every page has a title and a description', () => {
  const without = [];

  const files = [
    ...fs.readdirSync(routes).map((name) => [name, routes]),
    ...fs.readdirSync(docs).map((name) => [name, docs]),
  ];

  for (const [name, dir] of files) {
    if (!name.endsWith('.html') || name.startsWith('_')) continue;
    const source = fs.readFileSync(path.join(dir, name), 'utf8');

    if (!/<title>/.test(source)) without.push(`${name}: no <title>`);
    // The error pages are reached for rather than linked to, so they need no
    // description.
    if (!/name="description"/.test(source) && !/^(404|500)\.html$/.test(name)) {
      without.push(`${name}: no description`);
    }
  }

  assert.deepEqual(without, []);
});

test('the fonts the stylesheet names are the fonts that exist', () => {
  const css = fs.readFileSync(path.join(root, '..', 'app', 'styles', 'global.css'), 'utf8');
  const named = [...css.matchAll(/url\("?\/fonts\/([^")]+)"?\)/g)].map(([, file]) => file);
  assert.notEqual(named.length, 0, 'the stylesheet should name some fonts');

  const dir = path.join(root, '..', 'app', 'public', 'fonts');
  const missing = named.filter((file) => !fs.existsSync(path.join(dir, file)));

  assert.deepEqual(missing, [], `named but not present: ${missing.join(', ')}`);
});

const dist = path.join(root, '..', 'dist', 'static');

// These read what `npm run build` wrote. Without one they skip rather than fail,
// so a fresh clone gets a useful `npm test` and the reason is a missing build
// rather than an ENOENT from inside an assertion.
const describe = fs.existsSync(path.join(dist, 'index.html')) ? test : test.skip;

/** A prerendered page, as it was written to dist. */
function built(route) {
  const file = route === '/' ? 'index.html' : path.join(route.slice(1), 'index.html');
  return fs.readFileSync(path.join(dist, file), 'utf8');
}

describe('every page has a pager, and the ends have one link', () => {
  // Reading order comes from the nav, so a page added to one is in the other.
  // Getting that wrong is silent: the page renders, with nothing to read next.
  const links = navLinks();
  const [first, last] = [links[0], links[links.length - 1]];

  const start = built(first);
  assert.match(start, /class="pager"/);
  assert.doesNotMatch(start, /rel="prev"/, 'the first page offered a previous');
  assert.match(start, /rel="next"/);

  const end = built(last);
  assert.match(end, /rel="prev"/);
  assert.doesNotMatch(end, /rel="next"/, 'the last page offered a next');

  for (const route of links.slice(1, -1)) {
    const html = built(route);
    assert.match(html, /rel="prev"/, `${route} has no previous`);
    assert.match(html, /rel="next"/, `${route} has no next`);
  }
});

describe('the pager points at the page the nav puts next', () => {
  const links = navLinks();
  const html = built(links[2]);
  const next = html.match(/rel="next"[\s\S]*?href="([^"]+)"|href="([^"]+)"[^>]*rel="next"/);

  assert.ok(next, 'no next link');
  assert.equal(next[1] ?? next[2], links[3]);
});

test('the docs name the package that exists', () => {
  // `create-transclude` unscoped was never published: the package is
  // `@transclude/create`, and `npm create @transclude` is npm's own rule for
  // reaching it. The getting-started page told people to run the other one for
  // a while, which fails, and would run a stranger's code if anyone ever claimed
  // the name.
  const wrong = [];

  for (const dir of [routes, docs]) {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.html')) continue;
      const source = fs.readFileSync(path.join(dir, name), 'utf8');

      if (/npx\s+create-transclude/.test(source)) wrong.push(`${name}: npx create-transclude`);
      if (/npm\s+create\s+transclude/.test(source)) wrong.push(`${name}: unscoped npm create`);
    }
  }

  assert.deepEqual(wrong, [], `pages naming a package that does not exist: ${wrong.join(', ')}`);
});

test('the docs content comes before the nav in the document', () => {
  const layout = fs.readFileSync(path.join(docs, '_layout.html'), 'utf8');
  const content = layout.indexOf('<main>');
  const nav = layout.indexOf('<nav class="sidebar"');

  assert.ok(content > 0 && nav > 0, 'the layout has both a main and a sidebar');
  assert.ok(
    content < nav,
    'the sidebar has to follow the content, or a narrow screen and a screen reader both get the link list first',
  );

  // Source order is only half of it. The wide layout puts the sidebar back on
  // the left, which needs placement rather than flow.
  assert.match(layout, /\.sidebar\s*\{[^}]*grid-area:\s*1\s*\/\s*1/);
  assert.match(layout, /main\s*\{[^}]*grid-area:\s*1\s*\/\s*2/);
});

// The voice, in `design/voice.md`. Two of its rules are mechanical, so they are
// checked rather than remembered. The prose of a page is its paragraphs, its
// notes and its lede; a table cell and a code sample are not prose.
function prose(source) {
  // A file with no doc-page has no prose to read. `slice(-1)` would hand back
  // its last character and quietly find nothing.
  const start = source.indexOf('<doc-page');
  const body = start === -1 ? '' : source.slice(start);
  const found = [...body.matchAll(/<(?:p|doc-note[^>]*)>([\s\S]*?)<\/(?:p|doc-note)>/g)].map(
    ([, text]) => text,
  );
  const lede = source.match(/lede="([^"]*)"/)?.[1];
  if (lede) found.push(lede);

  return found.map((text) =>
    text
      .replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

/** Every page of the site, docs and landing alike. */
function pages() {
  const found = [];
  for (const dir of [routes, docs]) {
    for (const name of fs.readdirSync(dir)) {
      if (name.endsWith('.html')) found.push([name, fs.readFileSync(path.join(dir, name), 'utf8')]);
    }
  }
  return found;
}

test('one idea per sentence', () => {
  const long = [];
  for (const [name, source] of pages()) {
    for (const paragraph of prose(source)) {
      for (const sentence of paragraph.split(/(?<=[.!?])\s+/)) {
        const words = sentence.split(/\s+/).length;
        if (words >= 25) long.push(`${name}: ${words} words: ${sentence.slice(0, 60)}…`);
      }
    }
  }

  assert.deepEqual(long, [], `sentences joining two ideas, split them:\n${long.join('\n')}`);
});

test('nothing is sold and nothing is hedged', () => {
  // Every one of these is either selling or filler. `just` and `only` are left
  // out on purpose: both have an ordinary meaning this would not be able to
  // tell apart.
  const banned =
    /\b(simply|easily|easy|powerful|seamless|blazing|effortless|feel free|basically|essentially|in order to|needless to say|of course)\b/gi;

  const found = [];
  for (const [name, source] of pages()) {
    for (const paragraph of prose(source)) {
      for (const [word] of paragraph.matchAll(banned)) found.push(`${name}: ${word}`);
    }
  }

  assert.deepEqual(found, [], `words design/voice.md rules out: ${found.join(', ')}`);
});

test('the word is fragment, never region', () => {
  // `design/voice.md` spends its jargon on three words: hypermedia, element and
  // fragment. `region` is what the compiler and CLAUDE.md call the same thing,
  // and it reads naturally enough while writing that it kept arriving in prose.
  // Code keeps its own names; only what a reader sees is checked.
  const found = [];
  for (const [name, source] of pages()) {
    for (const paragraph of prose(source)) {
      if (/\bregions?\b/i.test(paragraph)) found.push(`${name}: ${paragraph.slice(0, 60)}…`);
    }
  }

  assert.deepEqual(found, [], `prose saying region:\n${found.join('\n')}`);
});
