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
  // The markup, which is the file minus its script blocks. Code samples live in
  // template literals inside `<script server>`, and a sample is not prose.
  //
  // This used to look for `<doc-page>` and start there. That left the landing
  // page checked for nothing but its lede, and it would have left every blog
  // post unchecked too, since a post is neither. Naming the thing to remove is
  // shorter than listing every shape a page can take.
  const body = source.replace(/<script[\s\S]*?<\/script>/g, '');
  // `<p class="lede">` is prose too. The pattern used to be `<(?:p|doc-note[^>]*)>`,
  // where the `[^>]*` belonged to `doc-note` alone, so a `p` with any attribute
  // at all was skipped. Every `class` on a paragraph was a paragraph nobody
  // checked, on every page.
  const found = [...body.matchAll(/<(?:p|doc-note)(?:\s[^>]*)?>([\s\S]*?)<\/(?:p|doc-note)>/g)].map(
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

/**
 * Every page of the site: landing, docs, posts and whatever comes next.
 *
 * The whole tree, because it used to be `[routes, docs]` read one level deep.
 * That named the two directories that existed when it was written, so the first
 * post added under `routes/blog/` was checked by nothing at all. A directory is
 * a thing someone adds without thinking about this file.
 *
 * Named by path rather than basename: `index.html` is three different pages.
 */
function pages() {
  const found = [];

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith('.html')) {
        found.push([path.relative(routes, file), fs.readFileSync(file, 'utf8')]);
      }
    }
  };

  walk(routes);
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
  // fragment. `region` is what the compiler calls the same thing internally,
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

test('the documented defaults are the defaults', () => {
  // `loadProject` applied none of these until an example was written with a
  // short config, so the table was a description of what should happen. Now it
  // is a description of what does, and the two can drift again.
  // `defaults.js`, not `project.js`. They moved there when it turned out that
  // only Node ever applied them: a worker imports the config module directly, so
  // every key an author left out was undefined on the one runtime the docs
  // recommend. `createApp` applies them now, for all four.
  const source = path.join(
    root,
    '..',
    'node_modules',
    '@transclude',
    'core',
    'src',
    'defaults.js',
  );
  if (!fs.existsSync(source)) return; // not installed: nothing to compare against

  const code = fs.readFileSync(source, 'utf8');
  const block = code.slice(code.indexOf('const DEFAULTS = {'));
  const real = Object.fromEntries(
    [...block.slice(0, block.indexOf('};')).matchAll(/^\s*(\w+): (.+),$/gm)].map(([, key, value]) => [
      key,
      value.replace(/['`]/g, ''),
    ]),
  );
  assert.notEqual(Object.keys(real).length, 0, 'DEFAULTS was found and parsed');

  const page = fs.readFileSync(path.join(docs, 'config.html'), 'utf8');
  const body = page.slice(page.indexOf('<doc-page'));
  const documented = Object.fromEntries(
    [...body.matchAll(/<tr>\s*<td><code>(\w+)<\/code><\/td>\s*<td>([\s\S]*?)<\/td>/g)].map(
      ([, key, value]) => [
        key,
        value
          .replace(/<[^>]+>/g, '')
          .replace(/\s+/g, ' ')
          .replace(/['`]/g, '')
          .trim(),
      ],
    ),
  );

  const wrong = [];
  for (const [key, value] of Object.entries(real)) {
    if (documented[key] === undefined) wrong.push(`${key}: not in the table`);
    else if (documented[key] !== value) wrong.push(`${key}: table says ${documented[key]}, code says ${value}`);
  }

  assert.deepEqual(wrong, []);
});

test('the ports the examples page lists are the ports they run on', () => {
  // Each example has its own port so they can run at once, and the page is
  // where anyone reads which. A config moving and the page not is silent: the
  // command works and the URL under it is wrong.
  const page = fs.readFileSync(path.join(docs, 'examples.html'), 'utf8');
  const listed = [...page.matchAll(/npm run (\w+)\s+# http:\/\/localhost:(\d+)/g)].map(
    ([, name, port]) => /** @type {[string, number]} */ ([name, Number(port)]),
  );
  assert.notEqual(listed.length, 0, 'the page lists some');

  const wrong = [];
  for (const [name, port] of listed) {
    const config = path.join(root, '..', '..', 'examples', name, 'transclude.config.js');
    if (!fs.existsSync(config)) {
      wrong.push(`${name}: no such example`);
      continue;
    }

    const real = Number(fs.readFileSync(config, 'utf8').match(/port:\s*(\d+)/)?.[1]);
    if (real !== port) wrong.push(`${name}: page says ${port}, config says ${real}`);
  }

  // 1960 is what a new project gets. An example there would collide with the
  // first thing anyone makes after reading the docs.
  const ports = listed.map(([, port]) => port);
  assert.ok(!ports.includes(1960), '1960 is left free for a new project');
  assert.equal(new Set(ports).size, ports.length, 'two examples cannot share a port');

  assert.deepEqual(wrong, []);
});

test('every post is a file, and every post file is listed', () => {
  // Two places name a post: `app/data/posts.js`, which the index and the feed
  // read, and the route file, which is the writing. Neither can be derived from
  // the other, so they are checked against each other instead.
  //
  // An entry with no file is a link to a 404 and a feed item that goes nowhere.
  // A file with no entry is a page nothing links to and no feed mentions, which
  // is the quieter of the two.
  const dir = path.join(routes, 'blog');
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.html') && !name.startsWith('_') && name !== 'index.html')
    .map((name) => name.replace(/\.html$/, ''))
    .sort();

  const source = fs.readFileSync(path.join(root, '..', 'app', 'data', 'posts.js'), 'utf8');
  const listed = [...source.matchAll(/slug:\s*'([^']+)'/g)].map(([, slug]) => slug).sort();

  assert.notEqual(listed.length, 0, 'posts.js lists none');
  assert.deepEqual(listed, files, 'posts.js and app/routes/blog/ disagree');
});

test('a post says when it was written, in a machine-readable way', () => {
  // The feed carries the date, and so should the page. A reader arriving from a
  // search result has no other way to tell how old the writing is.
  const dir = path.join(routes, 'blog');

  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.html') || name.startsWith('_') || name === 'index.html') continue;
    const source = fs.readFileSync(path.join(dir, name), 'utf8');
    assert.match(source, /<time[^>]*datetime=/, `${name} has no machine-readable date`);
  }
});
