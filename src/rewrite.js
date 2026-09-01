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
const STRIP = new Set([
  'script', 'iframe', 'object', 'embed', 'base', 'link', 'style',
  'animate', 'set', 'animateMotion', 'animateTransform',
  // Deprecated raw-text elements. parse5 reads their content as text, so the
  // walk never inspects it, and whether a browser reads it as text depends on
  // flags parse5 does not have: `<noembed>` on embed support, `<noframes>` on
  // frames. A `<img onerror>` hidden in one survives the clean here and can
  // parse live in the page that includes it. None has a use in a fragment.
  'xmp', 'plaintext', 'listing', 'noembed', 'noframes',
]);

/** Attributes holding a URL, and what a URL there is allowed to be. */
const NAVIGATIONAL = new Set(['href', 'action', 'formaction', 'ping', 'longdesc', 'cite']);
const FETCHABLE = new Set(['src', 'poster', 'data', 'background']);
const SRCSET = new Set(['srcset', 'imagesrcset']);

/** Schemes an attribute may name. Anything else is dropped. */
const SAFE_SCHEMES = new Set(['http', 'https', 'mailto', 'tel', 'ftp']);

/** Schemes `absolutize` rebases a relative URL against. The rest it leaves. */
const REBASE_SCHEMES = new Set(['http', 'https', 'ftp']);

/**
 * The scheme a browser will act on, which is not always the one the bytes spell.
 *
 * Before it reads a URL, the parser removes every ASCII tab and newline from it,
 * wherever they sit, and ignores leading C0 controls and spaces. So
 * `java&#9;script:` and a leading `\x01` both read as `javascript:` to a
 * browser, while a checker matching the raw text sees a scheme-less string and
 * calls it relative. That gap kept an executable `javascript:` past this
 * sanitizer, on `href`, `xlink:href` and every other URL attribute. `new URL`
 * normalizes the same way, so the value went on to be absolutized straight back
 * into a live `javascript:`. Normalize the way the parser does, then read.
 *
 * Only tab (U+0009), LF (U+000A) and CR (U+000D) are stripped from the interior,
 * because those are the three the URL parser removes; a form feed left inside a
 * scheme is not, and stays scheme-breaking to the browser too.
 *
 * @param {string} value an attribute value
 * @returns {string|null} the lowercased scheme, or null when there is none
 */
export function schemeOf(value) {
  const normalized = value.replace(/[\t\n\r]/g, '').replace(/^[\x00-\x20]+/, '');
  return normalized.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase() ?? null;
}

/** A `data:` URL the browser reads as an image, after the same normalizing. */
function isDataImage(value) {
  const normalized = value.replace(/[\t\n\r]/g, '').replace(/^[\x00-\x20]+/, '');
  return /^data:image\//i.test(normalized);
}

/**
 * `<meta http-equiv="refresh">` navigates the page it lands in. Nothing about a
 * transcluded fragment should be able to do that.
 */
const isRefresh = (node) =>
  node.tagName === 'meta' &&
  node.attrs?.some((a) => a.name === 'http-equiv' && /^refresh$/i.test(a.value));

/**
 * Children, and a `<template>`'s from `.content`, where parse5 keeps them
 * instead of on `childNodes`.
 *
 * A walk that reads `childNodes` alone stops at every template and everything
 * inside one travels unread. Template content is inert, but a declarative
 * shadow root is not: `<template shadowrootmode="open">` becomes a real shadow
 * tree in the page that includes it, and a `<script>` in there runs. So the
 * cleaning goes in. `src/extract.js` keeps its own `kidsOf` that stops at a
 * template, because it answers the other question: what a fragment URL returns.
 *
 * The field is what is asked about, not the tag name. `<template>` inside
 * `<svg>` is an ordinary SVG element that happens to be called that, and its
 * children are on `childNodes` like anything else's.
 */
function kidsOf(node) {
  if (node.content) return node.content.childNodes ?? [];
  return node.childNodes ?? [];
}

/**
 * Children as parse5 stored them, for the one reader that must not descend. A
 * `<base>` inside a template does nothing in a browser, so reading one would
 * let markup that never took effect retarget every URL in the document.
 */
const ownKidsOf = (node) => node.childNodes ?? [];

const HTML_NS = 'http://www.w3.org/1999/xhtml';

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
 * inserted into. `<link>` and `<style>` go because their rules are not scoped to
 * the fragment: both restyle the whole page the fragment lands in, one by
 * pulling a stylesheet from anywhere and one by carrying it. `<base>` and
 * `<link>` are read for their own purposes before this runs.
 *
 * SVG animation is on the list for a different reason: it changes an attribute
 * after this has read it. `<animate attributeName="href" to="javascript:...">`
 * leaves an `<a>` navigating to a value nothing checked, and the value can also
 * arrive through `from` or as one item of a `values` list, so refusing the four
 * animation elements is a smaller rule than reading all three.
 *
 * A `style` attribute is the other kind. It paints the element it sits on and
 * nothing else, so it is kept unless `styles` says otherwise. Dropping them by
 * default would flatten the source's own meaning: a highlighted code block
 * carries its colors that way.
 *
 * @param {object} root a parse5 tree, modified in place
 * @param {{ styles?: 'keep'|'strip' }} [options]
 * @returns {string[]} what was taken out, for a caller that wants to report it
 */
export function sanitize(root, { styles = 'keep' } = {}) {
  const removed = [];

  const visit = (node) => {
    // A copy, because the walk removes from the live list.
    for (const child of [...kidsOf(node)]) {
      // Comments are dropped, the way the compiler drops them from a page it
      // built. A foreign comment renders nothing, and its boundary is a known
      // confusion surface: a conditional comment or a stray `--!>` can carry
      // markup the walk never sees and a browser re-parses live.
      if (child.nodeName === '#comment') {
        removed.push('#comment');
        remove(child);
        continue;
      }
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
        if (styles === 'strip' && attr.name === 'style') {
          removed.push('@style');
          return false;
        }
        // Removed rather than emptied. An empty value still means something:
        // `href=""` names the page the fragment lands in, and `action=""`
        // submits to it, neither of which the source wrote.
        if (!allowedUrl(child, attr)) {
          removed.push(`@${attr.name}`);
          return false;
        }
        return true;
      });

      visit(child);
    }
  };

  visit(root);
  return removed;
}

/**
 * Whether a URL-bearing attribute may stay.
 *
 * `javascript:` is refused everywhere. `data:` is refused everywhere except an
 * image source, where it is ordinary and cannot navigate anything.
 */
function allowedUrl(element, attr) {
  const holdsUrl =
    NAVIGATIONAL.has(attr.name) || FETCHABLE.has(attr.name) || isXlink(attr.name);
  if (!holdsUrl) return true;

  if (!attr.value.trim()) return true;

  // `schemeOf`, not a match on the raw value: a browser strips tab and newline
  // and leading controls before it reads the scheme, so `java&#9;script:` is a
  // live `javascript:` to it and a scheme-less string to a raw match. Reading
  // the raw value here let exactly that through.
  const scheme = schemeOf(attr.value);
  if (!scheme) return true; // relative, resolved later

  if (scheme === 'data') {
    return element.tagName === 'img' && attr.name === 'src' && isDataImage(attr.value);
  }
  return SAFE_SCHEMES.has(scheme);
}

const isXlink = (name) => name === 'xlink:href' || name === 'href';

// ---- absolute URLs ---------------------------------------------------------

/**
 * The document's own idea of where it is.
 *
 * A `<base href>` wins over the URL the response came from, because that is
 * what the source document's own relative links were written against. It has to
 * be one the browser would have honored: `<base>` inside `<svg>` is an SVG
 * element of that name and retargets nothing, and template content is inert.
 *
 * @param {string} html
 * @param {string} responseUrl the URL after every redirect
 * @returns {string} what relative URLs resolve against
 */
export function baseOf(html, responseUrl) {
  const found = parse(html);
  let href = null;

  const visit = (node) => {
    for (const child of ownKidsOf(node)) {
      if (!isElement(child)) continue;
      if (child.tagName === 'base' && child.namespaceURI === HTML_NS && !href) {
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

/** What HTML counts as whitespace between srcset candidates. */
const SRCSET_SPACE = new Set([' ', '\t', '\n', '\r', '\f']);

/**
 * A `srcset`, as a list of candidates.
 *
 * It cannot be split on commas: a URL may contain one, and plenty do. A
 * candidate's URL ends at whitespace, or at a comma that is part of the URL
 * token itself, which is the rule the HTML parser uses.
 *
 * @param {string} value
 * @returns {Array<{ url: string, descriptor: string }>} split on the commas that separate
 *   candidates rather than the ones inside a URL
 */
export function parseSrcset(value) {
  const out = [];
  const ws = (c) => SRCSET_SPACE.has(c);
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

/**
 * `url()` references inside a style attribute or a `<style>` block.
 *
 * @param {string} css
 * @param {string} base
 * @returns {string}
 */
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
 *
 * @param {object} root modified in place
 * @param {string} base
 * @returns {object} the same root
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

        // Only a relative URL or one of the rebasable schemes is made absolute.
        // Anything else — `mailto:`, `tel:`, `data:`, and by the time this runs
        // the sanitizer has dropped the dangerous ones — is left as written, so
        // a scheme reached through a tab or a control character cannot be turned
        // into a live absolute URL here the way `new URL` would.
        const scheme = schemeOf(attr.value);
        if (scheme && !REBASE_SCHEMES.has(scheme)) continue;

        // `ping` is the one attribute here holding a list rather than a URL.
        if (attr.name !== 'ping') {
          attr.value = absolute(attr.value, base);
          continue;
        }

        const urls = attr.value.split(/\s+/).filter(Boolean);
        attr.value = urls.map((url) => absolute(url, base)).join(' ');
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
