// Addressable regions: `<ul id="results" fragment>`.
//
// A region renders inline as part of its page *and* compiles to a function that
// renders it alone. One compiled region either way, so a swap cannot drift from
// the document it replaces part of. The name is the element's id, so the word in
// the URL and the word a swap targets are the same word.

import test from 'node:test';
import assert from 'node:assert/strict';

import { splitBlocks, compilePage } from '../src/compiler/index.js';
import { compileFragment, CompileError } from '../src/compiler/codegen.js';
import { renderFragment } from '../src/document.js';

const compile = (source, opts = {}) =>
  compileFragment(splitBlocks(source).nodes, { page: true, ...opts });

const run = (body, data = {}) =>
  new Function(
    '__e', '__a', '__str', '__sh', 'html', '__d', '__slots', '__fragment',
    `let __o = '';\n${body}\nreturn __o;`,
  )(
    (v) => String(v ?? ''), () => '', (v) => String(v ?? ''), () => '', (v) => v,
    data, {}, true,
  );

// ---- collection -----------------------------------------------------------

test('a region is collected under its id', () => {
  const { regions } = compile('<ul id="results" fragment><li>a</li></ul>');
  assert.deepEqual(Object.keys(regions), ['results']);
});

test('the region includes the element itself, so outerHTML swaps work', () => {
  const { regions } = compile('<ul id="results" fragment><li>a</li></ul>');
  assert.equal(run(regions.results), '<ul id="results"><li>a</li></ul>');
});

test('the directive is stripped, the id is kept', () => {
  const { body } = compile('<ul id="results" fragment><li>a</li></ul>');
  assert.doesNotMatch(run(body), /fragment/);
  assert.match(run(body), /id="results"/);
});

test('a region renders inline as well: one region, two uses', () => {
  const { body, regions } = compile('<p>before</p><ul id="results" fragment><li>a</li></ul>');
  assert.equal(run(body), '<p>before</p><ul id="results"><li>a</li></ul>');
  assert.ok(run(body).includes(run(regions.results)), 'the page contains exactly what the swap sends');
});

test('a region reads the same data the page does', () => {
  const { regions } = compile('<ul id="r" fragment><li each="x of xs">${x}</li></ul>');
  assert.equal(run(regions.r, { xs: ['a', 'b'] }), '<ul id="r"><li>a</li><li>b</li></ul>');
});

test('several regions each get their own', () => {
  const { regions } = compile('<p id="a" fragment>1</p><p id="b" fragment>2</p>');
  assert.deepEqual(Object.keys(regions), ['a', 'b']);
});

test('a page with no regions exports an empty map', () => {
  const { code } = compilePage('<p>plain</p>', { runtime: '/rt.js' });
  assert.match(code, /export const regions = \{\};/);
});

// ---- what it refuses ------------------------------------------------------

test('a region needs an id, because the id is its name', () => {
  assert.throws(() => compile('<ul fragment><li>a</li></ul>'), /no id/);
});

test('an interpolated id cannot be asked for by any URL', () => {
  assert.throws(() => compile('<ul id="r-${n}" fragment>a</ul>'), /not knowable at compile time/);
});

test('"fragment" takes no value, so there is only ever one name', () => {
  assert.throws(() => compile('<ul id="results" fragment="other">a</ul>'), /takes no value/);
});

for (const directive of ['if="ok"', 'each="x of xs"']) {
  test(`a region cannot also carry ${directive.split('=')[0]}`, () => {
    assert.throws(
      () => compile(`<ul id="r" fragment ${directive}>a</ul>`),
      (error) => error instanceof CompileError && /one element with one id/.test(error.message),
    );
  });
}

test('a region inside a loop has no id of its own', () => {
  assert.throws(
    () => compile('<div each="x of xs"><ul id="r" fragment>${x}</ul></div>'),
    /inside a loop/,
  );
});

test('two regions cannot share a name', () => {
  assert.throws(() => compile('<p id="a" fragment>1</p><p id="a" fragment>2</p>'), /both named "a"/);
});

test('a component has no URL to be asked for', () => {
  assert.throws(
    () => compileFragment(splitBlocks('<ul id="r" fragment>a</ul>').nodes, { page: false }),
    /no URL to be asked for/,
  );
});

// ---- renderFragment -------------------------------------------------------

const pageOf = (over = {}) => ({
  layouts: [],
  load: async () => ({ n: 1 }),
  render: (d) => ({ default: `<body-of-${d.n}>` }),
  regions: { list: (d) => `<list-of-${d.n}>` },
  ...over,
});

test('a named region renders alone', async () => {
  assert.equal(await renderFragment(pageOf(), {}, { region: 'list' }), '<list-of-1>');
});

test('no region named is the page body, without its layouts', async () => {
  const page = pageOf({ layouts: [{ load: async () => ({}), render: () => ({ default: 'WRAPPED' }) }] });
  assert.equal(await renderFragment(page, {}, {}), '<body-of-1>');
});

test('an unknown region is null, so the caller can say 404', async () => {
  assert.equal(await renderFragment(pageOf(), {}, { region: 'nope' }), null);
});

test('layout loaders still run, since the page reads what they returned', async () => {
  // Skipping them would quietly change the data the region renders from.
  const ran = [];
  const page = pageOf({
    layouts: [
      {
        load: async () => {
          ran.push('layout');
          return { n: 9 };
        },
        render: () => ({ default: 'unused' }),
      },
    ],
    load: async ({ layout }) => {
      ran.push('page');
      return { n: layout.n };
    },
  });

  assert.equal(await renderFragment(page, {}, { region: 'list' }), '<list-of-9>');
  assert.deepEqual(ran, ['layout', 'page']);
});

test('a region is rendered in fragment mode', async () => {
  // Which is what leaves a component inside it bare.
  let sawFragment = null;
  const page = pageOf({ regions: { list: (d, slots, fragment) => ((sawFragment = fragment), 'x') } });

  await renderFragment(page, {}, { region: 'list' });
  assert.equal(sawFragment, true);
});
