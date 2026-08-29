/**
 * What the response is served as. A reader picks the parser from this.
 *
 * @param {object|null|undefined} config
 * @returns {string}
 */
export declare const feedType: (config: object | null | undefined) => string;
/**
 * Where it is mounted, and where the build writes it.
 *
 * @param {object|null|undefined} config
 * @returns {string}
 */
export declare const feedPath: (config: object | null | undefined) => string;
/**
 * @param {object} [config] the `feed` block, plus its `items`
 * @returns {Promise<string>} an RSS or Atom document
 * @throws when Atom is asked for without an author or a date
 */
export declare function feed(config?: object): Promise<string>;
