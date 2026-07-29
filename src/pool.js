/**
 * Runs `worker` over `items` with at most `limit` in flight, preserving order.
 *
 * Rendering itself is synchronous and CPU-bound, so this buys nothing on its
 * own — the win is that loaders await I/O, and a build of a hundred pages should
 * not wait for a hundred round trips one at a time.
 */
export async function pool(items, limit, worker) {
  const results = new Array(items.length);
  const width = Math.max(1, Math.min(limit, items.length));
  let next = 0;

  const runners = Array.from({ length: width }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}
