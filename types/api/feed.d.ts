export type FeedItem = {
    title?: string;
    url?: string;
    author?: string;
    date?: string | number | Date;
    /**
     * the parsed date, added on the way through
     */
    at?: Date | null;
};
export type FeedConfig = {
    /**
     * every link is absolute, so this is required
     */
    hostname?: string;
    title?: string;
    format?: 'rss' | 'atom';
    /**
     * required for Atom, unless every item has one
     */
    author?: string;
    updated?: string | number | Date;
    /**
     * where it is mounted
     */
    path?: string;
    limit?: number;
    items?: FeedItem[] | (() => FeedItem[] | Promise<FeedItem[]>);
};
/**
 * What the response is served as. A reader picks the parser from this.
 *
 * @param {FeedConfig|null|undefined} config
 * @returns {string}
 */
export declare const feedType: (config: FeedConfig | null | undefined) => string;
/**
 * Where it is mounted, and where the build writes it.
 *
 * @param {FeedConfig|null|undefined} config
 * @returns {string}
 */
export declare const feedPath: (config: FeedConfig | null | undefined) => string;
/**
 * @param {FeedConfig} [config] the `feed` block, plus its `items`
 * @returns {Promise<string>} an RSS or Atom document
 * @throws when Atom is asked for without an author or a date
 */
export declare function feed(config?: FeedConfig): Promise<string>;
