// Markdown pages. A `.md` file under `routes/` is converted to HTML, and every
// step after that is the one an `.html` page takes.
//
// The framework ships no Markdown parser. `markdown` in the config is a function
// from source to HTML, the same way `cache` is a store with four methods: which
// flavor, which extensions and which highlighter are the app's to pick, and
// none of them becomes a dependency of this package.
//
// Three readers exist and they must not disagree: the plugin compiles a page,
// the type checker reads the same page to collect its names, and `npm run check`
// reads it again to place a diagnostic. All three come through here.

export const MARKDOWN_EXT = '.md';

/** @param {string} file @returns {boolean} */
export const isMarkdown = (file) => file.endsWith(MARKDOWN_EXT);

/**
 * The source a compiler should see: HTML as written, Markdown converted.
 *
 * A `<script server>` block needs no new syntax to survive this. CommonMark
 * starts an HTML block at `<script` and ends it at `</script>`, with everything
 * between passed through raw, so the loader arrives at `splitBlocks` exactly as
 * it would from an `.html` file.
 *
 * @param {string} file    the path, which decides whether anything happens
 * @param {string} source  what is on disk
 * @param {((source: string, file: string) => string)|null} markdown from the config
 * @returns {string} HTML
 * @throws when a `.md` page exists and the config has no converter
 */
export function sourceOf(file, source, markdown) {
  if (!isMarkdown(file)) return source;

  if (typeof markdown !== 'function') {
    throw new Error(
      `[transclude] ${file} is Markdown, and transclude.config.js sets no "markdown". ` +
        'It takes (source, file) and returns HTML. This package ships no parser, ' +
        'so the flavor is yours to choose.',
    );
  }

  const html = markdown(source, file);
  if (typeof html !== 'string') {
    throw new Error(
      `[transclude] markdown() returned ${html === null ? 'null' : typeof html} for ${file}. ` +
        'It has to return a string of HTML.',
    );
  }

  return html;
}
