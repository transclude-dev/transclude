export declare const MARKDOWN_EXT = ".md";
/** @param {string} file @returns {boolean} */
export declare const isMarkdown: (file: string) => boolean;
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
export declare function sourceOf(file: string, source: string, markdown: ((source: string, file: string) => string) | null): string;
