export type Part = {
    type: 'text';
    value: string;
} | {
    type: 'expr';
    value: string;
};
/**
 * @typedef {{ type: 'text', value: string } | { type: 'expr', value: string }} Part
 */
/**
 * Text and `${expr}` in source order.
 *
 * `\${` is a literal `${`. It matters most to a page that documents this syntax,
 * and to a Markdown page, whose code fences are full of shell and JavaScript
 * that means `${` literally.
 *
 * @param {string} str raw text or an attribute value
 * @returns {Part[]} empty only for an empty string
 * @throws if a `${` is never closed
 */
export declare function splitInterpolations(str: string): Part[];
/**
 * Whether a string holds an interpolation, without parsing one.
 *
 * A `\${` is a literal and does not count, which is what the leading character
 * in the pattern is checking.
 *
 * @param {string} str
 * @returns {boolean}
 */
export declare function hasInterpolation(str: string): boolean;
