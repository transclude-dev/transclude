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
 * A `style` attribute is the other kind. It paints the element it sits on and
 * nothing else, so it is kept unless `styles` says otherwise. Dropping them by
 * default would flatten the source's own meaning: a highlighted code block
 * carries its colors that way.
 *
 * @param {object} root a parse5 tree, modified in place
 * @param {{ styles?: 'keep'|'strip' }} [options]
 * @returns {string[]} what was taken out, for a caller that wants to report it
 */
export declare function sanitize(root: object, { styles }?: {
    styles?: 'keep' | 'strip';
}): string[];
/**
 * The document's own idea of where it is.
 *
 * A `<base href>` wins over the URL the response came from, because that is
 * what the source document's own relative links were written against.
 *
 * @param {string} html
 * @param {string} responseUrl the URL after every redirect
 * @returns {string} what relative URLs resolve against
 */
export declare function baseOf(html: string, responseUrl: string): string;
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
export declare function parseSrcset(value: string): Array<{
    url: string;
    descriptor: string;
}>;
/**
 * `url()` references inside a style attribute or a `<style>` block.
 *
 * @param {string} css
 * @param {string} base
 * @returns {string}
 */
export declare function rewriteCss(css: string, base: string): string;
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
export declare function absolutize(root: object, base: string): object;
