/**
 * The three parts of an `each`, or null when it does not parse.
 *
 * @param {string} value the attribute as written
 * @returns {{ item: string, index: string|null, list: string }|null}
 */
export declare function parseEach(value: string): {
    item: string;
    index: string | null;
    list: string;
} | null;
