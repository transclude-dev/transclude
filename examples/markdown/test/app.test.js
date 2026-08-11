// Markdown pages, over real requests.
//
// The build has to have run: every assertion asks the built app for a URL, and
// `describe` skips rather than throws when there is nothing built to ask.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const built = fs.existsSync(path.join(root, 'dist', 'routes.json'));
const describe = built ? test : test.skip;

const { app } = built ? await import('@transclude/core/production') : { app: null };
const text = (url) => app.request(`http://localhost${url}`).then((res) => res.text());

describe('a .md file answers the URL its path names', async () => {
  const res = await app.request('http://localhost/');

  assert.equal(res.status, 200);
  assert.match(await res.text(), /<h1>Markdown pages<\/h1>/);
});

describe('the loader runs, and the page reads what it returned', async () => {
  const markup = await text('/');

  // From `<script server>` in the Markdown file, which needed no frontmatter to
  // get there: CommonMark passes a script block through raw.
  assert.match(markup, /<title>Markdown pages<\/title>/);
  assert.match(markup, /There are 3 notes below/);
});

describe('a directive in the Markdown renders on the server', async () => {
  const markup = await text('/');

  assert.match(markup, /<strong>One file<\/strong>/);
  assert.match(markup, /<strong>No runtime<\/strong>/);
});

describe('a code fence says ${ and means it', async () => {
  // The one thing a Markdown page needs that an HTML page rarely does. Without
  // the escape in app/lib/markdown.js this is a compile error, or worse, an
  // empty string where the sample should be.
  const markup = await text('/');

  assert.match(markup, /echo "\$\{HOME\}\/notes"/);
  assert.match(markup, /Hello, \$\{name\}/);
  assert.doesNotMatch(markup, /\\\$\{/, 'the backslash is the escape, not output');
});

describe('prose still interpolates', async () => {
  const markup = await text('/');

  // `${count}` in a paragraph read the loader. Both behaviors in one document
  // is the point: the difference is the code fence, not the file.
  assert.match(markup, /There are 3 notes/);
});

describe('an element in Markdown is rendered, not shipped', async () => {
  const markup = await text('/');

  // The host tag stays and the slot is filled. What is not here is a script:
  // a light element is markup by the time it leaves the server.
  assert.match(markup, /<site-note tone="warn"><p><strong>This is bold<\/strong>/);
  assert.doesNotMatch(markup, /<script/);
});

describe('the element styles are hoisted into head once', async () => {
  const markup = await text('/');

  assert.equal(markup.split('data-transclude="site-note"').length - 1, 1);
  assert.match(markup, /@scope \(site-note\)/);
});

describe('an .html page in the same directory is unaffected', async () => {
  const markup = await text('/about');

  assert.match(markup, /<h1>About<\/h1>/);
  assert.match(markup, /This app has 2 pages\./);
});

describe('both pages are files, because neither reads the request', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'dist', 'routes.json'), 'utf8'));

  assert.deepEqual(manifest.routes.map((route) => route.id).sort(), ['about', 'index']);
  assert.equal(manifest.routes.filter((route) => route.prerendered === false).length, 0);
});
