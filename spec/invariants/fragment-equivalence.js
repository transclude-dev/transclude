// A fragment is the same markup alone as it is in the page.
//
// For each page a case asked for, and each fragment the case marks: when the
// page holds an element with that id, `?fragment=<id>` answers that element and
// its subtree, and nothing else. A case that asked only for a fragment has its
// page asked too, so the corpus's fragment cases all count. A fragment the page
// includes from another route is left out, because the other route answers for
// it.
//
// One difference is documented, in the note "A shadow root in a fragment paints
// on connect" on `/docs/elements`: a shadow element arrives bare in a fragment.
// So the page's copy loses each declarative shadow root before the two are
// compared. Nothing else is taken off.

import { parse, serializeOuter } from 'parse5';
import { lineDiff, normalize } from '../runner/compare.js';
import { attribute, fragmentIds, includedIds } from './source.js';

export const name = 'fragment equivalence';

/**
 * @param {import('../runner/invariants.js').Context} context
 * @returns {Promise<string[]>}
 */
export async function check({ caseDir, fragmentParam, exchanges, ask }) {
  if (fragmentParam === null) return [];
  const included = includedIds(caseDir);
  const ids = [...fragmentIds(caseDir)].filter((id) => !included.has(id));
  const problems = [];
  for (const { url, init } of pagesAsked(exchanges, fragmentParam)) {
    const page = await ask('GET', url, init);
    if (!isDocument(page)) continue;
    const tree = parse(page.body);
    for (const id of ids) {
      const element = byId(tree, id);
      if (!element) continue;
      const fragmentUrl = withFragment(url, fragmentParam, id);
      const alone = await ask('GET', fragmentUrl, init);
      problems.push(...differ(fragmentUrl, alone, element));
    }
  }
  return problems;
}

/**
 * Each page the case asked about, once, with the fragment parameter taken off:
 * a GET answered with HTML, or any request that named a fragment, a POST
 * included. Asked with the first request's headers and no body.
 *
 * @param {import('../runner/invariants.js').Context['exchanges']} exchanges
 * @param {string} param
 */
function pagesAsked(exchanges, param) {
  const pages = new Map();
  for (const { method, url, init, status, headers } of exchanges) {
    const html = method === 'GET' && status === 200 && headers.get('content-type')?.startsWith('text/html');
    const namesFragment = new URL(url, 'http://localhost').searchParams.has(param);
    if (!html && !namesFragment) continue;
    const page = withoutFragment(url, param);
    if (!pages.has(page)) pages.set(page, { url: page, init: { headers: init.headers } });
  }
  return pages.values();
}

/**
 * @param {string} url
 * @param {{ status: number, body: string }} alone what the fragment URL answered
 * @param {any} element the page's copy
 */
function differ(url, alone, element) {
  if (alone.status !== 200) return [`GET ${url}: expected 200, got ${alone.status}`];
  dropShadowRoots(element);
  const want = normalize(serializeOuter(element));
  const got = normalize(alone.body);
  if (want === got) return [];
  return [`GET ${url}: the fragment differs from its copy in the page\n${lineDiff(want, got)}`];
}

/** A whole document, as opposed to a fragment, an error or a redirect. */
function isDocument(answer) {
  if (answer.status !== 200) return false;
  if (!answer.headers.get('content-type')?.startsWith('text/html')) return false;
  return /^\s*<!doctype/i.test(answer.body);
}

/**
 * The first element with this id, in document order. Not inside a template:
 * a template's content is not part of the page.
 *
 * @param {any} node
 * @param {string} id
 */
function byId(node, id) {
  for (const child of node.childNodes ?? []) {
    if (child.tagName && attribute(child, 'id') === id) return child;
    const found = byId(child, id);
    if (found) return found;
  }
  return null;
}

/**
 * Every `<template shadowrootmode>` under an element, taken out.
 *
 * @param {any} node
 */
function dropShadowRoots(node) {
  const kept = [];
  for (const child of node.childNodes ?? []) {
    const shadowRoot = child.tagName === 'template' && attribute(child, 'shadowrootmode') !== null;
    if (shadowRoot) continue;
    dropShadowRoots(child);
    kept.push(child);
  }
  node.childNodes = kept;
}

/**
 * The URL with the fragment parameter set and every other parameter kept.
 *
 * @param {string} url
 * @param {string} param `fragmentParam` from the case's config
 * @param {string} id
 */
export function withFragment(url, param, id) {
  const parsed = new URL(url, 'http://localhost');
  parsed.searchParams.set(param, id);
  return parsed.pathname + parsed.search;
}

/**
 * @param {string} url
 * @param {string} param
 */
function withoutFragment(url, param) {
  const parsed = new URL(url, 'http://localhost');
  parsed.searchParams.delete(param);
  return parsed.pathname + parsed.search;
}
