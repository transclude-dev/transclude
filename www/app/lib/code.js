// Syntax highlighting, in the loader. Every page here is prerendered, so this
// runs at build time and the browser gets plain markup.

import { createHighlighter } from 'shiki';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

/** @type {Awaited<ReturnType<typeof createHighlighter>> | null} */
let highlighter = null;

async function ready() {
  highlighter ??= await createHighlighter({
    themes: ['github-light-high-contrast', 'github-dark-high-contrast'],
    langs: ['html', 'js', 'json', 'css', 'shell'],
    // The JavaScript engine, not the default one. The default is Oniguruma
    // compiled to Wasm, and workerd refuses to compile Wasm at runtime, so a
    // live render that reached this file returned 500 there and nowhere else.
    engine: createJavaScriptRegexEngine(),
  });
  return highlighter;
}

/**
 * Both themes in one pass. Each token carries a light and a dark value as
 * custom properties, and the stylesheet picks between them.
 *
 * The high-contrast pair, because github-dark's comment token reads Lc 28 on
 * this background and APCA wants 60 for code.
 *
 * @param {string} source
 * @param {'html' | 'js' | 'json' | 'css' | 'shell' | 'text'} [lang]
 * @returns {Promise<string>}
 */
export async function code(source, lang = 'html') {
  const shiki = await ready();

  return shiki.codeToHtml(source.trim(), {
    lang,
    themes: { light: 'github-light-high-contrast', dark: 'github-dark-high-contrast' },
    defaultColor: false,
  });
}

const escape = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * A directory listing. No grammar fits one, so the parts are marked up here:
 * a path, and the comment that lines up after it. A name ending in `/` is a
 * directory.
 *
 * @param {string} source
 * @returns {string}
 */
export function tree(source) {
  const lines = source.trim().split('\n').map((line) => {
    // Two or more spaces after the path is the gap before the comment. One
    // space cannot be it, or `[...path].html /docs/*` would split wrongly.
    const [, path = '', gap = '', note = ''] = line.match(/^(.*?\S)(\s{2,})(\S.*)$/) ?? [];
    const named = path || line;
    const kind = named.trimEnd().endsWith('/') ? 't-dir' : 't-path';

    // A line with nothing after it is a whole path, comment or not.
    if (!path) return `<span class="${kind}">${escape(line)}</span>`;

    return `<span class="${kind}">${escape(path)}</span>${gap}<span class="t-note">${escape(note)}</span>`;
  });

  return `<pre class="tree"><code>${lines.join('\n')}</code></pre>`;
}

/**
 * Highlights every value of an object, keeping its keys.
 *
 * @param {Record<string, string | [string, string]>} samples
 * @returns {Promise<Record<string, string>>}
 */
export async function all(samples) {
  /** @type {Record<string, string>} */
  const out = {};

  for (const [name, value] of Object.entries(samples)) {
    const [source, lang] = Array.isArray(value) ? value : [value, 'html'];
    out[name] = await code(source, /** @type {any} */ (lang));
  }

  return out;
}
