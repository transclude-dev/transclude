/**
 * Runs `worker` over `items` with at most `limit` in flight, preserving order.
 *
 * Rendering itself is synchronous and CPU-bound, so this buys nothing on its
 * own. Loaders wait on I/O, and a build of a hundred pages should not wait for a
 * hundred round trips one at a time.
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} limit at least 1, and never more than `items.length`
 * @param {(item: T, index: number) => Promise<R>} worker
 * @returns {Promise<R[]>} in the order `items` were given, not the order they finished
 */
export declare function pool<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]>;
