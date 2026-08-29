/**
 * The `ctx` a loader is handed while the build renders it to a file.
 *
 * `revalidateTag` and `after` are refusals rather than absences. Left off the
 * object they are `undefined`, and a loader calling one fails with `x is not a
 * function`, which names neither what the page did nor how to stop. Both stay in
 * the generated type either way, because the checker cannot know which pages
 * become files.
 *
 * @param {object} options
 * @param {{ id: string, pattern?: string }} options.route
 * @param {string} options.url the path being written
 * @param {Record<string, string>} options.params
 * @param {string|null} [options.cookieSecret]
 * @param {string} [options.metadataBase]
 * @returns {object} the same shape a request gets, minus what a file cannot have
 */
export declare function prerenderContext({ route, url, params, cookieSecret, metadataBase }: {
    route: {
        id: string;
        pattern?: string;
    };
    url: string;
    params: Record<string, string>;
    cookieSecret?: string | null;
    metadataBase?: string;
}): object;
/**
 * Throws unless what was rendered can be written to a file.
 *
 * Called after the render rather than during it, because three of the four are
 * things a loader does on the way past and only the finished `ctx` knows about.
 * Every message continues a sentence whose subject is the page, since that is
 * what the build prints above it.
 *
 * @param {object} ctx the context the render was given
 * @param {string|Response} html what the render answered
 * @throws when this URL cannot be one file
 */
export declare function refusePrerender(ctx: object, html: string | Response): void;
