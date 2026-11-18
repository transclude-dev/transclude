// How an actual response is held against an expected one.
//
// Status is equal or it is not. Headers are a subset: a case names the headers
// its rule is about, and a header it does not name is not part of that rule.
// Bodies go through parse5 on both sides, so a difference in markup counts and
// a difference in how much whitespace sits between elements does not.

import { parse, parseFragment, serialize } from 'parse5';

// Whitespace inside these is content and stays as it is.
const KEEPS_WHITESPACE = new Set(['pre', 'textarea', 'script', 'style']);

/**
 * Markup in a form two answers can be compared in: parsed, and every run of
 * whitespace in text cut to one space, then serialized.
 *
 * Cut, not dropped. Whether a space sits between two inline elements changes
 * what a reader sees, so its presence counts. How much whitespace there is
 * does not, because a browser shows a run of it as one space.
 *
 * @param {string} markup
 * @returns {string}
 */
export function normalize(markup) {
  const isDocument = /^\s*<!doctype/i.test(markup);
  const tree = isDocument ? parse(markup) : parseFragment(markup);
  collapseWhitespace(tree);
  return withoutHashes(serialize(tree));
}

/**
 * A built asset's content hash, replaced with `[hash]`. The hash changes with
 * any edit to the file behind it, which is not a change in behavior. Which
 * asset a page names, and that it names one at all, still counts.
 *
 * @param {string} markup
 */
function withoutHashes(markup) {
  return markup.replace(/(\/assets\/[\w.-]+?)-[\w-]{8}\.(js|css)\b/g, '$1-[hash].$2');
}

/**
 * Normalized markup with a break between tags, so a diff points at the
 * element that differs. For reading only: the comparison uses `normalize`,
 * because a script body can hold `><` of its own.
 *
 * @param {string} normalized
 */
function byElement(normalized) {
  return normalized.replace(/> ?</g, '>\n<');
}

/** @param {any} node */
function collapseWhitespace(node) {
  if (KEEPS_WHITESPACE.has(node.nodeName)) return;
  if (node.nodeName === '#text') node.value = node.value.replace(/\s+/g, ' ');
  for (const child of node.childNodes ?? []) collapseWhitespace(child);
  // A template's children live on `content`, not `childNodes`.
  if (node.content) collapseWhitespace(node.content);
}

/**
 * Every difference between what a case expects and what came back. An empty
 * list is a pass.
 *
 * @param {{ status?: number, headers?: Record<string, string>, body?: string,
 *   exact?: boolean }} expected
 *   `body` is the expected markup, already read from its file. `exact` compares
 *   it byte for byte, for a body that is not HTML
 * @param {{ status: number, headers: Headers, body: string }} actual
 * @returns {string[]}
 */
export function differences(expected, actual) {
  const found = [];

  if (expected.status !== undefined && expected.status !== actual.status) {
    found.push(`status: expected ${expected.status}, got ${actual.status}`);
  }

  for (const [name, value] of Object.entries(expected.headers ?? {})) {
    const got = actual.headers.get(name);
    // A hash in a header counts as `[hash]`, as it does in a body: a `Link`
    // header names the same assets a page does.
    const same = got === value || (got !== null && value !== null && withoutHashes(got) === withoutHashes(value));
    if (!same) found.push(`header ${name.toLowerCase()}: expected ${JSON.stringify(value)}, got ${JSON.stringify(got)}`);
  }

  if (expected.body !== undefined && expected.exact) {
    if (expected.body !== actual.body) found.push(`body:\n${lineDiff(expected.body, actual.body)}`);
  }

  if (expected.body !== undefined && !expected.exact) {
    const want = normalize(expected.body);
    const got = normalize(actual.body);
    if (want !== got) found.push(`body:\n${lineDiff(byElement(want), byElement(got))}`);
  }

  return found;
}

/**
 * A plain line diff: lines only in the expected side start with `-`, lines
 * only in the actual side with `+`. A longest-common-subsequence table, which
 * is fine at the size of one response.
 *
 * @param {string} want
 * @param {string} got
 * @returns {string}
 */
export function lineDiff(want, got) {
  const a = want.split('\n');
  const b = got.split('\n');
  const table = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      const same = a[i] === b[j];
      table[i][j] = same ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const lines = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push(`  ${a[i]}`);
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      lines.push(`- ${a[i++]}`);
    } else {
      lines.push(`+ ${b[j++]}`);
    }
  }
  while (i < a.length) lines.push(`- ${a[i++]}`);
  while (j < b.length) lines.push(`+ ${b[j++]}`);
  return lines.join('\n');
}
