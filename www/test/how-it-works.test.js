// The explorer, run rather than read.
//
// It is one generated file holding a script and the payload that script reads,
// and the two are written in different places. A shape change on one side is
// silent until a browser loads it: the page renders its markup, the script
// throws partway down, and everything after that point is simply missing.
//
// That happened. `modules` changed from a string to an array of highlighted
// lines, one call site kept calling `.split('\n')` on it, and the file built
// clean and shipped with no code on it. So this executes the real script
// against the real payload and fails on anything it throws.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const page = path.join(root, 'app', 'public', 'how-it-works.html');

// Written by `prebuild`. Without it these skip, the way the tests that read
// `dist` do, so a fresh clone still gets a useful `npm test`.
const describe = fs.existsSync(page) ? test : test.skip;

/** As much of a DOM as the script touches on the way down. */
function browser() {
  const made = new Map();
  const element = (id) => ({
    id,
    innerHTML: '',
    textContent: '',
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {},
    removeAttribute() {},
    addEventListener() {},
    querySelector: () => null,
    scrollIntoView() {},
    focus() {},
  });

  return {
    made,
    document: {
      getElementById(id) {
        if (!made.has(id)) made.set(id, element(id));
        return made.get(id);
      },
      // Nothing is queried before the markup it would match is written, so an
      // empty list is the honest answer and the listener loops bind nothing.
      querySelectorAll: () => [],
      addEventListener() {},
      activeElement: null,
    },
  };
}

/** Runs the page's own script, and hands back what it wrote into the DOM. */
function run() {
  const html = fs.readFileSync(page, 'utf8');
  const from = html.lastIndexOf('<script>');
  const to = html.lastIndexOf('</script>');
  assert.ok(from !== -1 && to > from, 'the page has no script to run');

  const dom = browser();
  const context = { document: dom.document, console, probe: {} };
  // The handlers are reachable only from inside the script's own scope, and
  // most of what the page writes is written by one of them. Handing them out
  // is what lets this exercise a click rather than only a page load.
  vm.runInNewContext(
    `${html.slice(from + '<script>'.length, to)}\n;Object.assign(probe, { light, ask, LABELS, ASKS });`,
    context,
  );
  return { wrote: dom.made, ...context.probe };
}

describe('the page runs without throwing', () => {
  // The whole point. Everything below only says what it did afterwards.
  assert.doesNotThrow(run);
});

describe('both panes are painted, and carry highlighting', () => {
  const { wrote } = run();

  for (const id of ['src', 'out']) {
    const html = wrote.get(id).innerHTML;
    assert.ok(html.length > 0, `#${id} was left empty`);
    assert.match(html, /--shiki-light/, `#${id} has no highlighted tokens`);
    assert.match(html, /class="ln tok"/, `#${id} has no clickable lines`);
  }

  assert.match(wrote.get('src-n').textContent, /^\d+ lines$/);
  assert.match(wrote.get('out-n').textContent, /^\d+ lines$/);
});

describe('every section writes something', () => {
  const { wrote } = run();

  for (const id of ['legend', 'build-stages', 'serve-stages', 'fate', 'asks', 'touched', 'index']) {
    assert.ok(wrote.get(id)?.innerHTML.length > 0, `#${id} was left empty`);
  }
  assert.ok(wrote.get('answer').innerHTML.length > 0, 'no answer for the first request');
  assert.match(wrote.get('foot').textContent, /\d+ modules/);
});

describe('nothing rendered a value that was not there', () => {
  // The failure this file exists for did throw. One that reads a missing field
  // does not: it writes `undefined` into the page and looks like a layout bug.
  //
  // Every handler is run, because most of what a reader sees is written by one
  // of them. Checking the page as it loads would have missed a bad field in the
  // text each block shows when it is picked.
  const { wrote, light, ask, LABELS, ASKS } = run();

  for (const tag of Object.keys(LABELS)) light(tag);
  for (let n = 0; n < ASKS.length; n++) ask(n);

  for (const [id, el] of wrote) {
    for (const written of [el.innerHTML, el.textContent]) {
      assert.doesNotMatch(String(written), /undefined|\bNaN\b/, `#${id} rendered a missing value`);
    }
  }
});

describe('the index lists every module, with a line count', () => {
  const { wrote } = run();
  const html = wrote.get('index').innerHTML;

  const listed = [...html.matchAll(/data-file="(src\/[^"]+)"/g)].map(([, f]) => f);
  const src = path.join(root, '..', 'src');
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith('.js')) found.push(path.relative(path.join(root, '..'), file));
    }
  };
  walk(src);

  assert.deepEqual(listed.sort(), found.sort(), 'the index and src/ disagree about what exists');
  // A count beside each name, and never a zero: an empty module means the
  // payload carried the file name and not the file.
  for (const [, count] of html.matchAll(/var\(--faint\)">(\d+)</g)) {
    assert.ok(Number(count) > 0, 'a module was listed with no lines');
  }
});
