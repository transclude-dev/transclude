// What an invariant reads from a case's own files, as opposed to its answers.
//
// The `fragment` attribute marks a fragment in the source, and the render takes
// it off. So the names of a case's fragments are only in the source. A `.md`
// page counts: it is compiled as a page once its converter is done, and the
// markup in it passes through.

import fs from 'node:fs';
import path from 'node:path';
import { parse as parseScript } from 'acorn';
import { parseFragment } from 'parse5';
import { attribute, elementsOf, textOf } from './tree.js';

// What a case holds about itself. Markup in these is expected output, not app.
const NOT_THE_APP = new Set(['expected', 'upstream']);

// The script types a browser runs. A script of any other type is a data block,
// such as JSON-LD or speculation rules, and asks for no JavaScript.
const RUNS = new Set(['', 'module', 'text/javascript', 'application/javascript']);

/**
 * Every literal `id` on an element marked `fragment`, in every page source of
 * the case. An id written with `${}` is left out: its value is known only once
 * the page renders.
 *
 * @param {string} caseDir
 * @returns {Set<string>}
 */
export function fragmentIds(caseDir) {
  const ids = new Set();
  for (const file of sourceFiles(caseDir)) {
    const tree = parseFragment(fs.readFileSync(file, 'utf8'));
    for (const element of elementsOf(tree)) {
      const id = attribute(element, 'id');
      const marked = attribute(element, 'fragment') !== null;
      if (marked && id !== null && !id.includes('${')) ids.add(id);
    }
  }
  return ids;
}

/**
 * Every id a `<transclude src="/route#id">` names. That copy belongs to the
 * other route: `/docs/includes` says the fragment lives there, so the page
 * that includes it does not answer for it.
 *
 * @param {string} caseDir
 * @returns {Set<string>}
 */
export function includedIds(caseDir) {
  const ids = new Set();
  for (const file of sourceFiles(caseDir)) {
    const tree = parseFragment(fs.readFileSync(file, 'utf8'));
    for (const element of elementsOf(tree)) {
      const src = element.tagName === 'transclude' ? attribute(element, 'src') : null;
      const hash = src?.indexOf('#') ?? -1;
      if (hash !== -1) ids.add(src.slice(hash + 1));
    }
  }
  return ids;
}

/**
 * The tags whose element says `export const shadow = true`. An element's file
 * is named for its tag.
 *
 * @param {string} caseDir
 * @returns {Set<string>}
 */
export function shadowTags(caseDir) {
  const tags = new Set();
  for (const file of sourceFiles(caseDir)) {
    const source = fs.readFileSync(file, 'utf8');
    if (/export const shadow = true\b/.test(source)) tags.add(path.basename(file, '.html'));
  }
  return tags;
}

/**
 * Where a case asks for client JavaScript, or `null` when it does not. A
 * script the browser runs asks, and so does an element that exports anything
 * but `properties`: behavior, members, state and form association each define
 * it, and `/docs/elements` says a definition is what ships. A light element of
 * plain markup asks for nothing.
 *
 * Erring toward "asks" is safe. It only means the invariant skips a case.
 *
 * @param {string} caseDir
 * @returns {string | null}
 */
export function askedForJavaScript(caseDir) {
  for (const file of sourceFiles(caseDir)) {
    const where = path.relative(caseDir, file);
    const tree = parseFragment(fs.readFileSync(file, 'utf8'));
    for (const script of elementsOf(tree).filter((element) => element.tagName === 'script')) {
      if (attribute(script, 'server') !== null) continue;
      if (attribute(script, 'element') !== null) {
        if (!onlyProperties(textOf(script))) return `${where}: its <script element> exports more than properties`;
        continue;
      }
      const type = (attribute(script, 'type') ?? '').toLowerCase();
      if (RUNS.has(type)) return `${where}: a <script> the browser runs`;
    }
  }
  return null;
}

/**
 * Whether an element's script is `export const properties = …` and nothing
 * else. Code that does not parse counts as more.
 *
 * @param {string} code
 */
function onlyProperties(code) {
  let program;
  try {
    program = parseScript(code, { ecmaVersion: 'latest', sourceType: 'module' });
  } catch {
    return false;
  }
  return program.body.every((statement) => {
    if (statement.type !== 'ExportNamedDeclaration') return false;
    if (statement.declaration?.type !== 'VariableDeclaration') return false;
    return statement.declaration.declarations.every((declarator) => declarator.id.name === 'properties');
  });
}

/** @param {string} dir */
function sourceFiles(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (NOT_THE_APP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(full));
    else if (entry.name.endsWith('.html') || entry.name.endsWith('.md')) found.push(full);
  }
  return found;
}
