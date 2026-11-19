// An element updated in place is the element rendered again.
//
// For each element a case defines: render it with one set of props, parse that
// the way a browser does, `bind` to it, and `update` it with a second set. The
// tree must then serialize the same as a fresh render of the second set. When
// `update` answers false, the element repaints instead, and nothing is compared.
//
// The props are generated from what the element declares. A string default gets
// hostile strings, a number numbers, a boolean booleans, and an object its own
// keys. An array gets a list of the first item's kind, or of strings, and half
// the lists end with their first item again. Anything else, such as a `Date`,
// keeps its default. An element that declares no props has nothing to vary, so
// it is left out.
//
// The element is compiled here through `@transclude/core/compiler`, the way the
// build compiles it, and parsed with `spec/runner/dom.js`, which is parse5 with the
// handful of DOM methods the runtime calls. Read `check` first; the rest serves
// it.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import fc from 'fast-check';
import { compileComponent, readFlags } from '@transclude/core/compiler';
import { installDocument, parseDom, serialize } from '../runner/dom.js';
import { hostile } from './hostile.js';

export const name = 'bind and update';

const RUNTIME = import.meta.resolve('@transclude/core/runtime');

// Pairs of props per element. The corpus has a few dozen elements, so this
// keeps the whole run in seconds.
const RUNS = 100;

/**
 * @param {import('../runner/invariants.js').Context} context
 * @returns {Promise<string[]>}
 */
export async function check({ buildDir, config }) {
  const elements = await compiled(buildDir, config);
  const problems = [];
  const restore = installDocument();
  try {
    for (const { tag, mod } of elements) {
      if (!Object.keys(mod.propDefs).length) continue;
      problems.push(...(await updatesInPlace(tag, mod)));
    }
  } finally {
    restore();
  }
  return problems;
}

/**
 * Generated pairs, until one updates into a tree a fresh render does not
 * make. fast-check then shrinks the pair and says which seed replays it.
 *
 * @param {string} tag
 * @param {any} mod the compiled element
 */
async function updatesInPlace(tag, mod) {
  const props = propsLike(mod.propDefs);
  const matchesFullRender = fc.property(props, props, (before, after) => {
    fc.pre(renders(mod, before) && renders(mod, after));
    const root = parseDom(markup(mod, before));
    const bindings = mod.bind(root, mod.coerce(before));
    if (mod.update(bindings, mod.coerce(after)) === false) return;
    const got = serialize(root);
    const want = serialize(parseDom(markup(mod, after)));
    if (got !== want) throw new Error(`updated:  ${got}\nrendered: ${want}`);
  });
  const run = await fc.check(matchesFullRender, { numRuns: RUNS });
  if (!run.failed) return [];
  const [before, after] = run.counterexample ?? [];
  const pair = `${JSON.stringify(before)} then ${JSON.stringify(after)}`;
  return [`<${tag}> ${pair} (seed ${run.seed}):\n${run.errorInstance?.message ?? run.error}`];
}

/**
 * What the element puts in its root: its style and its markup for a shadow
 * element, its markup alone for a light one.
 */
function markup(mod, props) {
  const html = mod.render(mod.coerce(props), {});
  if (mod.light || !mod.css) return html;
  return `<style>${mod.css}</style>${html}`;
}

/** Whether a full render of these props succeeds. A template may throw on one. */
function renders(mod, props) {
  try {
    markup(mod, props);
    return true;
  } catch {
    return false;
  }
}

/**
 * Props of the declared kinds.
 *
 * @param {unknown} value a declared default
 * @returns {fc.Arbitrary<unknown>}
 */
function propsLike(value) {
  if (typeof value === 'string') return hostile;
  if (typeof value === 'boolean') return fc.boolean();
  if (typeof value === 'number') return fc.oneof(fc.integer(), fc.double({ noNaN: true }));
  if (Array.isArray(value)) {
    const list = fc.array(value.length ? propsLike(value[0]) : hostile, { maxLength: 5 });
    // Half the lists repeat their first item, so a keyed `each` meets one key
    // twice. Left to chance, two equal items came up in about one run in six.
    return fc.oneof(list, list.map((items) => (items.length ? [...items, items[0]] : items)));
  }
  if (value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    const keys = Object.entries(value).map(([key, inner]) => [key, propsLike(inner)]);
    return fc.record(Object.fromEntries(keys));
  }
  return fc.constant(value);
}

/**
 * Every element in the case's elements directories, compiled and imported.
 *
 * Each module is written beside its source in the build directory, so an
 * import in its `<script element>` resolves as it did in the build. An element
 * that renders another imports it from `virtual:transclude-component/<tag>`,
 * which only the bundler resolves, so that one name is pointed at the other
 * element's file here. A file that does not compile is left out: the build has
 * already said why.
 *
 * @param {string} buildDir
 * @param {Record<string, any>} config
 */
async function compiled(buildDir, config) {
  const appDir = path.join(buildDir, config.appDir ?? 'app');
  const dirs = [config.elementsDir ?? 'elements'].flat().map((dir) => path.join(appDir, dir));
  const sources = dirs.flatMap((dir) => htmlFiles(dir));

  const components = new Map(sources.map((file) => [tagOf(file), pathToFileURL(moduleOf(file)).href]));
  const shadowTags = new Set(sources.filter((file) => isShadow(file)).map((file) => tagOf(file)));

  const written = [];
  for (const file of sources) {
    const tag = tagOf(file);
    try {
      const options = { tag, components, shadowTags, runtime: RUNTIME, filename: tag };
      const { code } = compileComponent(fs.readFileSync(file, 'utf8'), options);
      fs.writeFileSync(moduleOf(file), withComponentFiles(code, components));
      written.push({ tag, file });
    } catch {
      continue;
    }
  }
  const elements = [];
  for (const { tag, file } of written) {
    elements.push({ tag, mod: await import(pathToFileURL(moduleOf(file)).href) });
  }
  return elements;
}

/**
 * @param {string} code a compiled element
 * @param {Map<string, string>} components each tag's module, as a file URL
 */
function withComponentFiles(code, components) {
  let pointed = code;
  for (const [tag, url] of components) {
    pointed = pointed.replaceAll(JSON.stringify(`virtual:transclude-component/${tag}`), JSON.stringify(url));
  }
  return pointed;
}

/** @param {string} dir */
function htmlFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((entry) => entry.endsWith('.html'))
    .map((entry) => path.join(dir, entry));
}

/** @param {string} file */
const tagOf = (file) => path.basename(file, '.html');

/** @param {string} file */
const moduleOf = (file) => file.replace(/\.html$/, '.bind.mjs');

/** @param {string} file */
function isShadow(file) {
  try {
    return readFlags(fs.readFileSync(file, 'utf8')).shadow === true;
  } catch {
    return false;
  }
}
