/**
 * The three parts of an `each`, or null when it does not parse.
 *
 * `item, item of items` is refused: the index would shadow the item, and the
 * page would show `0`, `1` where it wrote `${item}`.
 *
 * @param {string} value the attribute as written
 * @returns {{ item: string, index: string|null, list: string }|null}
 */
export declare function parseEach(value: string): {
    item: string;
    index: string | null;
    list: string;
} | null;
