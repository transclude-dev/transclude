// Syntax highlighting, in the loader. Every page here is prerendered, so this
// runs at build time and the browser gets plain markup.

import { createHighlighter } from 'shiki';

/** @type {Awaited<ReturnType<typeof createHighlighter>> | null} */
let highlighter = null;

async function ready() {
  highlighter ??= await createHighlighter({
    themes: ['github-light', 'github-dark'],
    langs: ['html', 'js', 'json', 'css', 'shell'],
  });
  return highlighter;
}

/**
 * Both themes in one pass. Each token carries a light and a dark value as
 * custom properties, and the stylesheet picks between them.
 *
 * @param {string} source
 * @param {'html' | 'js' | 'json' | 'css' | 'shell' | 'text'} [lang]
 * @returns {Promise<string>}
 */
export async function code(source, lang = 'html') {
  const shiki = await ready();

  return shiki.codeToHtml(source.trim(), {
    lang,
    themes: { light: 'github-light', dark: 'github-dark' },
    defaultColor: false,
  });
}

/**
 * A directory listing. Not a language, so it is only escaped and wrapped.
 *
 * @param {string} source
 * @returns {Promise<string>}
 */
export const tree = (source) => code(source, 'text');

/**
 * Highlights every value of an object, keeping its keys.
 *
 * @param {Record<string, string | [string, string]>} samples
 * @returns {Promise<Record<string, string>>}
 */
export async function all(samples) {
  const out = {};

  for (const [name, value] of Object.entries(samples)) {
    const [source, lang] = Array.isArray(value) ? value : [value, 'html'];
    out[name] = await code(source, /** @type {any} */ (lang));
  }

  return out;
}
