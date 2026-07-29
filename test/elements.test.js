// What a fragment needs that a document already had: styles for the light
// elements in it, and definitions for the custom ones.
//
// A page's client entry covers what the page can render. A fragment can name
// anything, so the client watches the DOM instead — whatever put the tag there,
// it is there, and that is the signal.

import test from 'node:test';
import assert from 'node:assert/strict';

import { renderDocument } from '../src/document.js';
import { adoptStyles, defineLight, watch } from '../src/runtime/index.js';
import {
  compileClientEntry,
  compileElementsEntry,
  compileComponent,
  ELEMENTS_ENTRY,
} from '../src/compiler/index.js';

// ---- <head>: one marked <style> per light element -------------------------

const page = (over = {}) => ({
  css: '',
  headScript: '',
  hasTitle: false,
  renderTitle: () => '',
  renderHead: () => '',
  render: () => ({ default: '<p>x</p>' }),
  elements: [],
  ...over,
});

const light = (tag, css, elements = []) => ({ tag, light: true, css, elements });

test('a light element gets its own <style>, named after its tag', () => {
  const html = renderDocument([page({ elements: [light('site-note', '.a{}')] })], [{}]);
  assert.match(html, /<style data-hf="site-note">\n\.a\{\}\n<\/style>/);
});

test('the name is what lets a client tell whether the styles are already here', () => {
  // The only record of what <head> contains is <head>. Nothing is tracked
  // alongside it, so a swap and a render cannot disagree.
  const html = renderDocument([page({ elements: [light('a-b', '.a{}')] })], [{}]);
  assert.equal((html.match(/data-hf="a-b"/g) ?? []).length, 1);
});

test('rendering the same element twice still writes one <style>', () => {
  const html = renderDocument(
    [page({ elements: [light('a-b', '.a{}'), light('a-b', '.a{}')] })],
    [{}],
  );
  assert.equal((html.match(/data-hf="a-b"/g) ?? []).length, 1);
});

test('a shadow component contributes nothing to <head> — its styles are inside it', () => {
  const html = renderDocument(
    [page({ elements: [{ tag: 'u-c', light: false, css: '.a{}', elements: [] }] })],
    [{}],
  );
  assert.doesNotMatch(html, /data-hf="u-c"/);
});

test('nested elements are reached through their parent', () => {
  const html = renderDocument(
    [page({ elements: [light('outer', '.o{}', [light('inner', '.i{}')])] })],
    [{}],
  );
  assert.match(html, /data-hf="inner"/);
});

test("the page's own styles are marked, and come last", () => {
  const html = renderDocument([page({ css: '.page{}', elements: [light('a-b', '.a{}')] })], [{}]);
  const element = html.indexOf('data-hf="a-b"');
  const own = html.indexOf('data-hf-page');

  assert.ok(element !== -1 && own !== -1);
  assert.ok(element < own, 'a page overrides an element, so it has to be last');
});

test('a page with no styles of its own emits no block for them', () => {
  const html = renderDocument([page()], [{}]);
  assert.doesNotMatch(html, /<style/);
});

// ---- the elements manifest ------------------------------------------------

test('every element in the app is one dynamic import away', () => {
  const { code } = compileElementsEntry(['site-note', 'user-card']);
  assert.match(code, /"site-note": \(\) => import\("virtual:hf-component\/site-note"\)/);
  assert.match(code, /"user-card": \(\) => import\("virtual:hf-component\/user-card"\)/);
});

test('a thunk, not a URL — only the bundler knows where the chunk lands', () => {
  const { code } = compileElementsEntry(['a-b']);
  assert.doesNotMatch(code, /\.js/, 'a filename here would need a manifest to keep in sync');
});

test('the map is sorted, so the same app builds byte-identically', () => {
  assert.equal(compileElementsEntry(['b-b', 'a-a']).code, compileElementsEntry(['a-a', 'b-b']).code);
});

test('an app with no elements still exports a map', () => {
  const { code } = compileElementsEntry([]);
  assert.match(code, /export const elements = \{/);
});

// ---- the client entry -----------------------------------------------------

const entry = (opts) => compileClientEntry([{ source: '<p>x</p>', filename: 'p.html' }], opts.manifest ?? { tags: [] }, opts).code;

test('with fragments on, a page watches for tags it did not render', () => {
  const code = entry({ runtime: '/rt.js', elements: true });
  assert.match(code, /import \{ watch as __watch \} from "\/rt\.js"/);
  assert.match(code, new RegExp(`from "${ELEMENTS_ENTRY}"`));
  assert.match(code, /__watch\(__elements\);/);
});

test('with fragments off, a page ships exactly what it renders', () => {
  const code = entry({ runtime: '/rt.js', elements: false });
  assert.doesNotMatch(code, /__watch/);
  assert.doesNotMatch(code, new RegExp(ELEMENTS_ENTRY));
});

test("the page's own tags are still static imports, defined before the watcher", () => {
  // Eager, because they are on screen at first paint. The watcher is for what
  // is not.
  const code = entry({ manifest: { tags: ['user-card'] }, runtime: '/rt.js', elements: true });
  assert.ok(
    code.indexOf('__D0();') < code.indexOf('__watch(__elements);'),
    'the watcher would import a second time what the entry already has',
  );
});

// ---- define() is transitive ----------------------------------------------

const componentOf = (source, over = {}) =>
  compileComponent(source, {
    tag: 'a-a',
    shadow: true,
    components: new Map([['b-b', 'b-b.html']]),
    shadowTags: new Set(['a-a', 'b-b']),
    runtime: '/rt.js',
    filename: 'a-a',
    ...over,
  }).code;

test('defining an element defines what it renders', () => {
  // An element found by the watcher has only itself to start from, and anything
  // it paints into a shadow root is out of reach of anything watching the
  // document.
  const code = componentOf('<b-b></b-b>');
  assert.match(code, /import __C0, \{ define as __C0_define \} from "virtual:hf-component\/b-b";/);
  assert.match(code, /__C0_define\(\);/);
});

test('an element that renders nothing defines only itself', () => {
  const code = componentOf('<p>x</p>');
  assert.doesNotMatch(code, /__C\d+_define/);
});

test('define is idempotent, because an element may render itself', () => {
  const code = componentOf('<a-a></a-a>', { components: new Map([['a-a', 'a-a.html']]) });
  assert.match(code, /let __defined = false;/);
  assert.match(code, /if \(__defined\) return;/);
});

test('a page does not pull in nested defines — its entry already listed them', () => {
  const code = componentOf('<b-b></b-b>');
  assert.equal((code.match(/__C0_define/g) ?? []).length, 2, 'import and call, nothing more');
});

// ---- watch ----------------------------------------------------------------
//
// Two globals and a querySelector is the whole surface it touches, which is why
// it can be exercised here at all. What it does with a real document is checked
// in the browser, by app/pages/check.html.

function fakeDom(present = []) {
  const tags = new Set(present);
  const observers = [];

  class FakeObserver {
    constructor(callback) {
      this.callback = callback;
      this.stopped = false;
      observers.push(this);
    }
    observe() {}
    disconnect() {
      this.stopped = true;
    }
  }

  const original = globalThis.MutationObserver;
  globalThis.MutationObserver = FakeObserver;

  return {
    root: { querySelector: (tag) => (tags.has(tag) ? { tag } : null) },
    observers,
    arrive(tag) {
      tags.add(tag);
      for (const observer of observers) if (!observer.stopped) observer.callback();
    },
    restore() {
      globalThis.MutationObserver = original;
    },
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('a tag already in the document is loaded without waiting for a mutation', async () => {
  const dom = fakeDom(['a-b']);
  const loaded = [];
  watch({ 'a-b': () => (loaded.push('a-b'), Promise.resolve({})) }, dom.root);

  await settle();
  assert.deepEqual(loaded, ['a-b']);
  dom.restore();
});

test('a tag that arrives later is loaded when it does', async () => {
  const dom = fakeDom();
  const loaded = [];
  watch({ 'a-b': () => (loaded.push('a-b'), Promise.resolve({})) }, dom.root);

  await settle();
  assert.deepEqual(loaded, [], 'nothing was there yet');

  dom.arrive('a-b');
  await settle();
  assert.deepEqual(loaded, ['a-b']);
  dom.restore();
});

test('the module it loads is the thing that defines the element', async () => {
  const dom = fakeDom(['a-b']);
  let defined = false;
  watch({ 'a-b': () => Promise.resolve({ define: () => (defined = true) }) }, dom.root);

  await settle();
  assert.equal(defined, true);
  dom.restore();
});

test('a tag is loaded once however many times it appears', async () => {
  const dom = fakeDom(['a-b']);
  let count = 0;
  watch({ 'a-b': () => (count++, Promise.resolve({})) }, dom.root);

  await settle();
  dom.arrive('a-b');
  dom.arrive('a-b');
  await settle();
  assert.equal(count, 1);
  dom.restore();
});

test('a tag that never appears costs one string and no request', async () => {
  const dom = fakeDom();
  let asked = false;
  watch({ 'a-b': () => ((asked = true), Promise.resolve({})) }, dom.root);

  dom.arrive('c-d');
  await settle();
  assert.equal(asked, false);
  dom.restore();
});

test('the observer stops once every tag it knows about has been seen', async () => {
  const dom = fakeDom(['a-b']);
  watch({ 'a-b': () => Promise.resolve({}) }, dom.root);

  await settle();
  assert.equal(dom.observers[0].stopped, true, 'still watching with nothing left to watch for');
  dom.restore();
});

test('a chunk that fails to load does not take the others down', async () => {
  const dom = fakeDom(['a-b', 'c-d']);
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args);

  let loaded = false;
  watch(
    {
      'a-b': () => Promise.reject(new Error('offline')),
      'c-d': () => ((loaded = true), Promise.resolve({})),
    },
    dom.root,
  );

  await settle();
  console.error = original;
  assert.equal(loaded, true);
  assert.equal(errors.length, 1, 'the failure was reported rather than swallowed');
  dom.restore();
});

test('no MutationObserver, no watching — and nothing thrown', () => {
  const original = globalThis.MutationObserver;
  delete globalThis.MutationObserver;
  assert.doesNotThrow(() => watch({ 'a-b': () => Promise.resolve({}) }, { querySelector: () => null }));
  globalThis.MutationObserver = original;
});

// ---- adoptStyles ----------------------------------------------------------

function fakeHead(existing = []) {
  const styles = existing.map((tag) => ({ tag, attrs: { 'data-hf': tag } }));
  const head = {
    insertBefore(node, before) {
      const at = before ? styles.indexOf(before) : styles.length;
      styles.splice(at === -1 ? styles.length : at, 0, node);
    },
  };
  const original = globalThis.document;

  globalThis.document = {
    head,
    createElement: () => ({
      attrs: {},
      setAttribute(name, value) {
        this.attrs[name] = value;
      },
    }),
    querySelector(selector) {
      const named = /^style\[data-hf="(.+)"\]$/.exec(selector);
      const key = named ? 'data-hf' : 'data-hf-page';
      return styles.find((s) => (named ? s.attrs[key] === named[1] : key in s.attrs)) ?? null;
    },
  };

  return { styles, restore: () => (globalThis.document = original) };
}

test("a light element's styles land in <head>, marked with its tag", () => {
  const dom = fakeHead();
  adoptStyles({ tag: 'a-b', light: true, css: '.a{}' });

  assert.equal(dom.styles.length, 1);
  assert.equal(dom.styles[0].attrs['data-hf'], 'a-b');
  assert.equal(dom.styles[0].textContent, '.a{}');
  dom.restore();
});

test('styles the document already has are left alone', () => {
  const dom = fakeHead(['a-b']);
  adoptStyles({ tag: 'a-b', light: true, css: '.a{}' });

  assert.equal(dom.styles.length, 1, 'a second copy of the same rules');
  dom.restore();
});

test('a shadow component adopts nothing — its styles are inside its root', () => {
  const dom = fakeHead();
  adoptStyles({ tag: 'u-c', light: false, css: '.a{}' });

  assert.equal(dom.styles.length, 0);
  dom.restore();
});

test('adopted styles go before the page block, not after it', () => {
  const dom = fakeHead();
  dom.styles.push({ attrs: { 'data-hf-page': '' } });
  adoptStyles({ tag: 'a-b', light: true, css: '.a{}' });

  assert.equal(dom.styles[0].attrs['data-hf'], 'a-b', 'a page still overrides an element');
  dom.restore();
});

test('on the server there is no document and nothing to do', () => {
  const original = globalThis.document;
  delete globalThis.document;
  assert.doesNotThrow(() => adoptStyles({ tag: 'a-b', light: true, css: '.a{}' }));
  globalThis.document = original;
});

test('a light element with nothing to define still gets its styles', () => {
  // defineLight registers no class for a partial with no behaviour — that is the
  // zero-JS trade. Styles are the half it still needs, and the half a swapped-in
  // one arrives without, so they have to be adopted before every early return.
  const dom = fakeHead();
  defineLight({ tag: 'a-b', light: true, css: '.a{}', members: {} }, null);

  assert.equal(dom.styles.length, 1, 'the early return skipped the styles too');
  dom.restore();
});
