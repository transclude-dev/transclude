// An element is light unless it asks for a shadow root.
//
// In every HTML answer a case was given, each declarative shadow root, a
// `<template shadowrootmode>` on a custom element, sits on one whose source
// says `export const shadow = true`. No other element of the app gets one.
//
// A host with no hyphen in its tag is not an element of the app. Its shadow
// root was written by hand, or came in foreign markup, which `/docs/includes`
// says keeps one, cleaned inside.

import { parse, parseFragment } from 'parse5';
import { shadowTags } from './source.js';
import { attribute, elementsOf } from './tree.js';

export const name = 'light DOM by default';

/**
 * @param {import('../runner/invariants.js').Context} context
 * @returns {Promise<string[]>}
 */
export async function check({ caseDir, exchanges }) {
  const shadow = shadowTags(caseDir);
  const problems = [];
  for (const { method, url, headers, body } of exchanges) {
    if (!headers.get('content-type')?.startsWith('text/html')) continue;
    const tree = /^\s*<!doctype/i.test(body) ? parse(body) : parseFragment(body);
    for (const template of elementsOf(tree)) {
      if (template.tagName !== 'template' || attribute(template, 'shadowrootmode') === null) continue;
      const host = template.parentNode?.tagName ?? '';
      if (host.includes('-') && !shadow.has(host)) problems.push(`${method} ${url}: <${host}> has a shadow root, and its source does not ask for one`);
    }
  }
  return problems;
}
