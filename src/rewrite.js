// Making a foreign document safe to put in a page, and making its links work.
//
// Two jobs over one tree. Sanitizing decides what is allowed to survive the
// trip. Rewriting turns every relative URL into one that still points at the
// source, since the markup is about to be read on a different origin.
//
// Both run over the whole document once, before it is indexed, so several
// fragments from one page pay for it once.

import { parse } from 'parse5';

/** Removed outright. Their content goes with them. */
const STRIP = new Set(['script', 'iframe', 'object', 'embed', 'base', 'link']);

/** Attributes holding a URL, and what a URL there is allowed to be. */
const NAVIGATIONAL = new Set(['href', 'action', 'formaction', 'ping', 'longdesc', 'cite']);
const FETCHABLE = new Set(['src', 'poster', 'data', 'background']);
const SRCSET = new Set(['srcset', 'imagesrcset']);

/** Schemes an attribute may name. Anything else is dropped. */
const SAFE_SCHEME = /^(https?:|mailto:|tel:|ftp:)/i;

/**
 * `<meta http-equiv="refresh">` navigates the page it lands in. Nothing about a
 * transcluded fragment should be able to do that.
 */
const isRefresh = (node) =>
  node.tagName === 'meta' &&
  node.attrs?.some((a) => a.name === 'http-equiv' && /^refresh$/i.test(a.value));

const kidsOf = (node) => node.childNodes ?? [];
const isElement = (node) => typeof node.tagName === 'string';

function remove(node) {
  const siblings = node.parentNode?.childNodes;
  if (!siblings) return;
  const at = siblings.indexOf(node);
  if (at !== -1) siblings.splice(at, 1);
}

/**
 * Strip what must not travel.
 *
 * `<base>` is on the list for a reason that is easy to miss: it does not affect
 * the fragment, it retargets every relative URL in the document the fragment is
 * inserted into. `<link>` goes because it can pull a stylesheet from anywhere.
 * Both are read for their own purposes before this runs.
 */
export function sanitize(root) {
  const removed = [];

  const visit = (node) => {
    // A copy, because the walk removes from the live list.
    for (const child of [...kidsOf(node)]) {
      if (!isElement(child)) continue;

      if (STRIP.has(child.tagName) || isRefresh(child)) {
        removed.push(child.tagName);
        remove(child);
        continue;
      }

      child.attrs = (child.attrs ?? []).filter((attr) => {
        // Every event handler, whatever it is called.
        if (/^on/i.test(attr.name)) {
          removed.push(`@${attr.name}`);
          return false;
        }
        return true;
      });

      for (const attr of child.attrs) {
        if (!allowedUrl(child, attr)) {
          removed.push(`@${attr.name}`);
          attr.value = '';
        }
      }

      visit(child);
    }
  };

  visit(root);
  return removed;
}

/**
 * Whether a URL-bearing attribute may keep its value.
 *
 * `javascript:` is refused everywhere. `data:` is refused everywhere except an
 * image source, where it is ordinary and cannot navigate anything.
 */
function allowedUrl(element, attr) {
  const holdsUrl =
    NAVIGATIONAL.has(attr.name) || FETCHABLE.has(attr.name) || isXlink(attr.name);
  if (!holdsUrl) return true;

  const value = attr.value.trim();
  if (!value) return true;

  const scheme = value.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  if (!scheme) return true; // relative, resolved later

  if (scheme === 'data') {
    return element.tagName === 'img' && attr.name === 'src' && /^data:image\//i.test(value);
  }
  return SAFE_SCHEME.test(value);
}

const isXlink = (name) => name === 'xlink:href' || name === 'href';

// ---- absolute URLs ---------------------------------------------------------

/**
 * The document's own idea of where it is.
 *
 * A `<base href>` wins over the URL the response came from, because that is
 * what the source document's own relative links were written against.
 */
export function baseOf(html, responseUrl) {
  const found = parse(html);
  let href = null;

  const visit = (node) => {
    for (const child of kidsOf(node)) {
      if (!isElement(child)) continue;
      if (child.tagName === 'base' && !href) {
        href = child.attrs?.find((a) => a.name === 'href')?.value ?? null;
      }
      visit(child);
    }
  };
  visit(found);

  if (!href) return responseUrl;
  try {
    return new URL(href, responseUrl).href;
  } catch {
    return responseUrl;
  }
}

const absolute = (value, base) => {
  try {
    return new URL(value, base).href;
  } catch {
    return value;
  }
};

/**
 * A `srcset`, as a list of candidates.
 *
 * It cannot be split on commas: a URL may contain one, and plenty do. A
 * candidate's URL ends at whitespace, or at a comma that is part of the URL
 * token itself, which is the rule the HTML parser uses.
 */
export function parseSrcset(value) {
  const out = [];
  const ws = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
  let i = 0;

  while (i < value.length) {
    while (i < value.length && (ws(value[i]) || value[i] === ',')) i += 1;
    if (i >= value.length) break;

    const from = i;
    while (i < value.length && !ws(value[i])) i += 1;
    let url = value.slice(from, i);
    let descriptor = '';

    if (url.endsWith(',')) {
      url = url.replace(/,+$/, '');
    } else {
      while (i < value.length && ws(value[i])) i += 1;
      const at = i;
      while (i < value.length && value[i] !== ',') i += 1;
      descriptor = value.slice(at, i).trim();
      if (value[i] === ',') i += 1;
    }

    if (url) out.push({ url, descriptor });
  }
  return out;
}

const CSS_URL = /url\(\s*(['"]?)([^'")]*)\1\s*\)/gi;

/** `url()` references inside a style attribute or a `<style>` block. */
export function rewriteCss(css, base) {
  return css.replace(CSS_URL, (whole, quote, url) => {
    const value = url.trim();
    if (!value || /^(data|blob):/i.test(value)) return whole;
    return `url(${quote}${absolute(value, base)}${quote})`;
  });
}

/**
 * Every relative URL made absolute against the source.
 *
 * A hash-only href is included on purpose. Left alone it would point at the
 * page the fragment was inserted into, which is a different document that
 * probably has no such id.
 */
export function absolutize(root, base) {
  const visit = (node) => {
    for (const child of kidsOf(node)) {
      if (!isElement(child)) continue;

      for (const attr of child.attrs ?? []) {
        if (SRCSET.has(attr.name)) {
          attr.value = parseSrcset(attr.value)
            .map(({ url, descriptor }) =>
              descriptor ? `${absolute(url, base)} ${descriptor}` : absolute(url, base),
            )
            .join(', ');
          continue;
        }

        if (attr.name === 'style') {
          attr.value = rewriteCss(attr.value, base);
          continue;
        }

        const holdsUrl =
          NAVIGATIONAL.has(attr.name) || FETCHABLE.has(attr.name) || isXlink(attr.name);
        if (!holdsUrl || !attr.value.trim()) continue;
        if (/^(data|blob|mailto:|tel:|javascript:)/i.test(attr.value.trim())) continue;

        attr.value =
          attr.name === 'ping'
            ? attr.value.split(/\s+/).filter(Boolean).map((u) => absolute(u, base)).join(' ')
            : absolute(attr.value, base);
      }

      if (child.tagName === 'style') {
        for (const text of kidsOf(child)) {
          if (text.nodeName === '#text') text.value = rewriteCss(text.value, base);
        }
      }

      visit(child);
    }
  };

  visit(root);
  return root;
}
