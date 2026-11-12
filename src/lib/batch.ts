/**
 * Runs `fn` over `items` with at most `size` calls in flight, batch after batch.
 * Tasks are only started inside the loop, so concurrency is really bounded
 * (each DB upsert holds a pooled connection; the knex pool max is 10).
 */
export async function runInBatches<T, R>(items: readonly T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    results.push(...(await Promise.all(batch.map(fn))));
  }
  return results;
}
