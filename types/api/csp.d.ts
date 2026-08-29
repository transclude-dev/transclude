/**
 * What a page gets when the config says `true`.
 *
 * `script-src` is hashed and `style-src` is not, which looks inconsistent and is
 * the only combination that works. A hash never covers an attribute: `style="…"`
 * on an element is checked against `style-src`, and the spec says a hash there
 * applies to `<style>` blocks only. Worse, `'unsafe-inline'` is *ignored* in a
 * directive that carries any hash, so listing both allows nothing extra.
 *
 * So hashing styles means no element may carry a `style` attribute, and
 * `style="view-transition-name: …"` is an ordinary thing to write here. Script
 * is where the protection matters: CSS cannot run code, and `script-src` stays
 * strict. Put `'hashes'` in `style-src` yourself if your pages have no inline
 * style attributes at all.
 */
export declare const CSP_DEFAULTS: {
    'default-src': string[];
    'script-src': string[];
    'style-src': string[];
    'img-src': string[];
    'object-src': string[];
    'base-uri': string[];
    'form-action': string[];
    'frame-ancestors': string[];
};
/**
 * `<script>` and `<style>` bodies in a document, in source order.
 *
 * Both are raw text elements: the browser ends them at the first closing tag
 * whatever the content, so matching that way is not an approximation of the
 * parser, it is the same rule. A `<script src>` runs a file rather than a body
 * and is covered by `'self'`, so it is skipped.
 *
 * @param {string} html the rendered document
 * @returns {Array<{ kind: string, body: string }>} every inline block, in source
 *   order, each saying which kind it is
 */
export declare function inlineSources(html: string): Array<{
    kind: string;
    body: string;
}>;
/**
 * The policy for one document.
 *
 * `'hashes'` in a source list is where this page's own digests go, so an author
 * replacing the defaults decides which directives get them. Empty means the
 * literal is dropped rather than left in, because `script-src 'self' 'hashes'`
 * with nothing to substitute is a policy naming a source that does not exist.
 *
 * @param {string} html
 * @param {{ directives?: Record<string, string[]> }} [options]
 * @returns {Promise<string>} the policy, with every `'hashes'` replaced
 */
export declare function policyFor(html: string, { directives }?: {
    directives?: Record<string, string[]>;
}): Promise<string>;
/**
 * The directives a meta tag cannot carry, as a header.
 *
 * None of them names a hash, so this string is the same for every page: it can
 * be set once as middleware, ahead of any route, and it costs a prerendered page
 * nothing. That is why the split is worth having rather than reading the meta
 * back out of a body that is already compressed.
 *
 * `null` when there are none, which is the default. Adding a header nobody asked
 * for is a header to explain later.
 *
 * @param {object|boolean|null} config
 * @returns {{ name: string, value: string }|null} the directives a meta tag
 *   cannot carry, and which header carries them
 */
export declare function headerPolicy(config: object | boolean | null): {
    name: string;
    value: string;
} | null;
/**
 * @param {string} html
 * @param {object|boolean|null} config
 * @returns {Promise<string>} the document with its meta tag, or unchanged when off
 */
export declare function withPolicy(html: string, config: object | boolean | null): Promise<string>;
