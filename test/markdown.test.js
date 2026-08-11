// Markdown pages. A `.md` file under `routes/` is a page, converted to HTML
// before anything compiles it.
//
// The conversion is the app's: `markdown` in the config is a function, and this
// package ships no parser. So most of what is worth asserting here is the seam
// rather than any flavor of Markdown. The fake converter below is deliberately
// stupid, because what is under test is where it is called and what happens when
// it is missing.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { isMarkdown, sourceOf, MARKDOWN_EXT } from '../src/markdown.js';
import { scanRoutes, toRoute } from '../src/routes.js';
import { splitBlocks } from '../src/compiler/index.js';
import { compileFragment } from '../src/compiler/codegen.js';

const route = (rel) => toRoute(rel.split('/').join(path.sep), rel);

function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-md-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return dir;
}

// ---- the route table ------------------------------------------------------

test('a .md file is a page at the URL its path names', () => {
  assert.equal(route('notes.md').pattern, '/notes');
  assert.equal(route('docs/intro.md').pattern, '/docs/intro');
  assert.equal(route('blog/index.md').pattern, '/blog');
  assert.equal(route('blog/[slug].md').pattern, '/blog/:slug');
});

test('a .md page keeps the id and params a .html one would have', () => {
  const html = route('blog/[slug].html');
  const md = route('blog/[slug].md');

  assert.equal(md.kind, 'page');
  assert.equal(md.id, html.id);
  assert.deepEqual(md.params, html.params);
});

test('scanRoutes finds .md alongside .html and .js', () => {
  const dir = fixture({
    'index.html': '<p>home</p>',
    'notes.md': '# Notes',
    'api/ping.js': 'export const GET = () => new Response("ok");',
  });

  const { routes, endpoints } = scanRoutes(dir);

  assert.deepEqual(routes.map((r) => r.pattern).sort(), ['/', '/notes']);
  assert.deepEqual(endpoints.map((r) => r.pattern), ['/api/ping']);
});

test('about.html and about.md is a collision, not a coin toss', () => {
  const dir = fixture({ 'about.html': '<p>x</p>', 'about.md': '# x' });

  assert.throws(() => scanRoutes(dir), /collide/);
});

test('an underscore keeps a .md file out of the route table', () => {
  // Markdown read as data by a loader, sitting beside the page that reads it.
  const dir = fixture({ 'blog/index.html': '<p>x</p>', 'blog/_posts/one.md': '# one' });

  assert.deepEqual(scanRoutes(dir).routes.map((r) => r.pattern), ['/blog']);
});

// ---- the conversion seam --------------------------------------------------

test('isMarkdown reads the extension and nothing else', () => {
  assert.equal(MARKDOWN_EXT, '.md');
  assert.equal(isMarkdown('/app/routes/notes.md'), true);
  assert.equal(isMarkdown('/app/routes/notes.html'), false);
  assert.equal(isMarkdown('/app/routes/md'), false);
});

test('an .html page is handed back untouched, converter or not', () => {
  const shout = () => '<p>CONVERTED</p>';

  assert.equal(sourceOf('page.html', '<p>as written</p>', shout), '<p>as written</p>');
  assert.equal(sourceOf('page.html', '<p>as written</p>', null), '<p>as written</p>');
});

test('a .md page is converted, and told which file it is', () => {
  const seen = [];
  const converter = (source, file) => {
    seen.push([source, file]);
    return `<h1>${source.slice(2)}</h1>`;
  };

  assert.equal(sourceOf('notes.md', '# Notes', converter), '<h1>Notes</h1>');
  assert.deepEqual(seen, [['# Notes', 'notes.md']]);
});

test('a .md page with no converter names the file and says what to write', () => {
  assert.throws(
    () => sourceOf('/app/routes/notes.md', '# Notes', null),
    (error) => {
      assert.match(error.message, /\/app\/routes\/notes\.md/);
      assert.match(error.message, /markdown/);
      assert.match(error.message, /\(source, file\)/);
      return true;
    },
  );
});

test('a converter that returns something other than a string is refused', () => {
  // The failure without this is a parse of `undefined` as HTML, which produces a
  // page rather than an error: empty, valid, and with nothing saying why.
  assert.throws(() => sourceOf('notes.md', '# Notes', () => undefined), /has to return a string/);
  assert.throws(() => sourceOf('notes.md', '# Notes', () => null), /has to return a string/);
  assert.throws(() => sourceOf('notes.md', '# Notes', () => ({})), /has to return a string/);
});

// ---- what the compiler makes of the result --------------------------------

const compile = (source) => compileFragment(splitBlocks(source).nodes, { page: true }).body;

test('a <script server> block survives conversion and is still the loader', () => {
  // CommonMark starts an HTML block at `<script` and ends it at `</script>`, so
  // a converter passes the loader through untouched. This asserts the half that
  // is ours: what comes out the other side is a page with a loader.
  const converted = ['<script server>', '  export default async () => ({ name: "Ada" });', '</script>', '<h1>Hi</h1>'].join(
    '\n',
  );

  assert.match(splitBlocks(converted).server.code, /export default/);
  assert.match(compile(converted), /<h1>Hi<\/h1>/);
});

test('interpolation works in converted markup', () => {
  assert.match(compile('<h1>${name}</h1>'), /__e\(__d\["name"\]\)/);
});

test('a fenced code block can say ${ without meaning it', () => {
  // The reason the escape matters here more than anywhere else. A Markdown page
  // is mostly prose and code samples, and a shell sample is full of `${VAR}`.
  const code = compile('<pre><code>echo "\\${HOME}"</code></pre>');

  assert.match(code, /\$\{HOME\}/);
  assert.doesNotMatch(code, /__e\(/);
});

test('the escape works in an attribute too', () => {
  // It did not. The static path emitted the raw attribute value, so the
  // backslash reached the page: `title="\${name}"` in, `title="\${name}"` out.
  // The emitted JS quotes the attribute, so the backslashes below are the string
  // literal's, not the escape's. What matters is that no `\` reaches the page.
  const code = compile('<a title="\\${name}">x</a>');

  assert.match(code, /title=\\"\$\{name\}\\"/);
  assert.doesNotMatch(code, /\\\\\\\\\$\{/);
});
