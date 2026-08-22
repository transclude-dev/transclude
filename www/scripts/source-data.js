#!/usr/bin/env node
// Writes `app/lib/source.js`: the framework's own code, highlighted, plus the
// worked example and the stage map the explorer is built from.
//
// A module rather than something a loader reads, because a loader that imports
// `node:fs` puts that import in the worker bundle, and workerd has no `node:fs`
// even for a page whose loader only ever ran at build time. `write-version.js`
// writes `app/lib/version.js` for the same reason.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compilePage } from '@transclude/core/compiler';

import { code } from '../app/lib/code.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const www = path.dirname(here);
const root = path.dirname(www);
const out = path.join(www, 'app', 'lib', 'source.js');

/** The page every stage is about. Small enough to read whole. */
export const EXAMPLE = `<script server>
  import { notes } from '../data/notes.js';

  export default async () => ({ notes: notes.all() });

  export const POST = async ({ request, url }) => {
    notes.add((await request.formData()).get('text'));
    return Response.redirect(new URL(url).origin + '/notes', 303);
  };
</script>

<title>Notes</title>

<style>
  .note { border-bottom: 1px solid #e3e3eb; }
</style>

<form method="post">
  <input name="text" required />
  <button>Add</button>
</form>

<ul id="list" fragment>
  <li class="note" each="note of notes">\${note.text}</li>
</ul>
`;

// Each stage names a real symbol. The line is looked up rather than typed, so a
// rename fails this build instead of shipping a link into the wrong function.
const STAGES = [
  ['compile', 'Read the file', 'One .html file is parsed by parse5. Not searched for strings: a <html> inside a comment is a comment.', 'src/compiler/index.js', 'splitBlocks'],
  ['compile', 'Split the blocks', 'server, properties, state, client script, head, styles, and the markup nodes. Each becomes a different export.', 'src/compiler/index.js', 'splitBlocks'],
  ['compile', 'Rewrite the loader', 'export default becomes a const the module can call. Verb exports pass through untouched.', 'src/compiler/script.js', 'bindDefaultExport'],
  ['compile', 'Read the expressions', 'Every interpolation is parsed by jsep, not by a regex, and emitted as JavaScript with each read escaped.', 'src/compiler/expr.js', 'emit'],
  ['compile', 'Emit render', 'The markup becomes string concatenation. Directives become if, for and a key.', 'src/compiler/codegen.js', 'compileFragment'],
  ['compile', 'Emit the fragments', 'Every element marked fragment becomes an entry in regions, from the same walk that produced render.', 'src/compiler/codegen.js', 'compileFragment'],
  ['compile', 'Assemble the module', 'The exports a page carries: css, elements, client, regions, includes, load, render.', 'src/compiler/index.js', 'compilePage'],
  ['compile', 'Hand it to Vite', 'Every page is a virtual module. Vite bundles one graph and writes dist/.', 'src/plugin.js', 'load'],
  ['build', 'Decide the route’s fate', 'A page is rendered to a file unless it reads the request. The build runs the loader to find out.', 'src/prerender.js', 'refusePrerender'],
  ['request', 'Trailing slash', '/about/ redirects to /about with a 301, so one page has one URL.', 'src/server.js', 'baseApp'],
  ['request', 'CSRF', 'Non-GET requests carrying a form content type need an Origin the app owns.', 'src/server.js', 'baseApp'],
  ['request', 'nosniff', 'The one security header with no judgment in it, so the framework sets it.', 'src/server.js', 'baseApp'],
  ['request', 'Your middleware', 'app/server.js runs here: before anything that serves bytes, so a guard covers files too.', 'src/server.js', 'baseApp'],
  ['request', 'Public files', 'Before the route table, so a real file beats a catch-all.', 'src/public-files.js', 'publicFiles'],
  ['request', 'Match a route', 'The directory tree, compiled to a Hono pattern.', 'src/routes.js', 'toRoute'],
  ['request', 'Build the context', 'url, params, cookies, response, fragment, after. Nothing that names one runtime.', 'src/app.js', 'createApp'],
  ['request', 'Run the layout chain', 'Outermost first, in order. Any one can return a Response and stop everything below it.', 'src/document.js', 'runGuards'],
  ['request', 'Run the action', 'Only for a non-GET. The fragment is checked before this, so a bad name changes nothing.', 'src/document.js', 'runAction'],
  ['request', 'Run the loader', 'Its return value is the only thing the markup can read.', 'src/document.js', 'renderRoute'],
  ['request', 'Render', 'render for a document, regions for a fragment. One module answers both.', 'src/document.js', 'renderFragment'],
  ['request', 'Resolve includes', 'Worked out before the page renders, which is what lets a prerendered page carry the result.', 'src/document.js', 'resolveIncludes'],
  ['request', 'Build the document', 'head tags hoisted, styles collected, the page assembled around the render.', 'src/document.js', 'renderDocument'],
  ['request', 'Build the policy', 'A Content-Security-Policy from the hashes of what the page actually inlined.', 'src/csp.js', 'withPolicy'],
  ['request', 'Send it', 'Cookies and headers survive whatever the handler returned.', 'src/document.js', 'withEnvelope'],
];

// Which lines of each pane belong to which block, so picking one shows the
// other. Every range carries the text its first line must contain: Shiki trims
// what it is given and the compiler's output moves, so a range that has drifted
// fails this build rather than pointing at the wrong lines.
const SOURCE_TAGS = [
  [1, 1, ['loader', 'action'], '<script server>'],
  [2, 5, ['loader'], 'import { notes }'],
  [6, 9, ['action'], 'export const POST'],
  [10, 10, ['loader', 'action'], '</script>'],
  [12, 12, ['title'], '<title>Notes</title>'],
  [14, 16, ['style'], '<style>'],
  [18, 21, ['markup'], '<form method="post">'],
  [23, 25, ['markup', 'fragment'], '<ul id="list" fragment>'],
];

const COMPILED_TAGS = [
  [5, 7, ['loader'], 'import { notes }'],
  [9, 12, ['action'], 'export const POST'],
  [15, 15, ['style'], 'export const css'],
  [18, 18, ['title'], 'export const hasTitle'],
  [21, 36, ['fragment'], 'export const regions'],
  [39, 42, ['loader'], 'export async function load'],
  [44, 48, ['title'], 'export function renderTitle'],
  [64, 71, ['markup'], 'export function render'],
  [72, 80, ['markup', 'fragment'], '__o += __named'],
  [81, 84, ['markup'], '__out.default'],
];

// The claim the explorer is built around, checked rather than asserted.
const SHARED = [
  [25, 33], // inside regions.list
  [72, 80], // inside render
];

const plain = (html) =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&#x3C;/g, '<')
    .replace(/&#x26;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"');

function checkTags(name, tags, lines) {
  for (const [from, to, , anchor] of tags) {
    if (to > lines.length) throw new Error(`[source-data] ${name} ${from}-${to} runs past ${lines.length} lines`);
    if (!plain(lines[from - 1]).includes(anchor)) {
      throw new Error(
        `[source-data] ${name} line ${from} should hold "${anchor}" and holds "${plain(lines[from - 1]).trim()}"`,
      );
    }
  }
  return tags.map(([from, to, names]) => [from, to, names]);
}

function sharedLines(source) {
  const all = source.trim().split('\n');
  const [[a1, a2], [b1, b2]] = SHARED;
  const left = all.slice(a1 - 1, a2);
  const right = all.slice(b1 - 1, b2);
  if (left.length !== right.length || left.some((line, i) => line !== right[i])) {
    throw new Error(
      '[source-data] the fragment and the document no longer emit the same lines. Either the ' +
        'compiler changed or the ranges did, and the explorer says they match.',
    );
  }
  return left.length;
}

function lineOf(file, symbol) {
  const lines = fs.readFileSync(path.join(root, file), 'utf8').split('\n');
  const declared = new RegExp(`(function|const|let|class)\\s+${symbol}\\b`);
  const member = new RegExp(`^\\s*${symbol}\\s*[:(]`);
  const at = lines.findIndex((line) => declared.test(line) || member.test(line));
  if (at === -1) throw new Error(`[source-data] ${symbol} is not declared in ${file}`);
  return at + 1;
}

/** Shiki's output, one entry per line, with the wrapper dropped. */
async function lines(source, lang) {
  const html = await code(source, lang);
  return html.slice(html.indexOf('<code>') + '<code>'.length, html.lastIndexOf('</code>')).split('\n');
}

function sources() {
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith('.js')) found.push(path.relative(root, file));
    }
  };
  walk(path.join(root, 'src'));
  return found.sort();
}

/** Everything the explorer reads. Exported so the standalone page shares it. */
export async function build() {
  const compiled = compilePage(EXAMPLE, {
    runtime: '/@transclude/runtime.js',
    filename: 'notes',
    sourcePath: '/app/routes/notes.html',
  });

  const modules = {};
  for (const file of sources()) {
    modules[file] = await lines(fs.readFileSync(path.join(root, file), 'utf8'), 'js');
  }

  const source = await lines(EXAMPLE, 'html');
  const output = await lines(compiled.code, 'js');

  return {
    source,
    compiled: output,
    sourceTags: checkTags('source', SOURCE_TAGS, source),
    compiledTags: checkTags('compiled', COMPILED_TAGS, output),
    shared: sharedLines(compiled.code),
    stages: STAGES.map(([phase, title, blurb, file, symbol]) => ({
      phase,
      title,
      blurb,
      file,
      symbol,
      line: lineOf(file, symbol),
    })),
    modules,
  };
}

// Compared through `fileURLToPath`, because `Atelier Dakroub` is a space and
// `import.meta.url` keeps it percent-encoded while argv does not.
if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const data = await build();
  const body = [
    '// Written by scripts/source-data.js. Do not edit.',
    '//',
    '// The framework\'s own code, highlighted at build time, plus the worked example',
    '// the explorer traces. A module rather than a file a loader reads, because a',
    '// loader importing `node:fs` puts that import in the worker bundle.',
    '',
    `export const source = ${JSON.stringify(data.source)};`,
    `export const compiled = ${JSON.stringify(data.compiled)};`,
    `export const sourceTags = ${JSON.stringify(data.sourceTags)};`,
    `export const compiledTags = ${JSON.stringify(data.compiledTags)};`,
    `export const shared = ${data.shared};`,
    `export const stages = ${JSON.stringify(data.stages)};`,
    `export const modules = ${JSON.stringify(data.modules)};`,
    `export const files = ${JSON.stringify(Object.keys(data.modules))};`,
    '',
  ].join('\n');

  fs.writeFileSync(out, body);
  console.log(`app/lib/source.js`);
  console.log(`  ${Object.keys(data.modules).length} modules, ${data.stages.length} stages`);
  console.log(`  the fragment and the document share ${data.shared} identical lines`);
  console.log(`  ${(body.length / 1024 / 1024).toFixed(2)} MB`);
}
