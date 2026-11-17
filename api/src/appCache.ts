/**
 * App-layer cache-aside (HW5 Task 2): a small in-process TTL cache for read routes that do real
 * database work. One instance, so in-memory is enough; with several instances each keeps its own
 * copy and invalidation arrives through the change-event fan-out (see server wiring).
 *
 * - getOrLoad returns { value, hit } so the route can send X-Cache: HIT | MISS.
 * - Concurrent misses for the same key share one load ("single flight"): a burst of requests
 *   after expiry reaches the database once, not once per request.
 * - invalidate(prefix) is called on every schedule write, so the first read after a write is a MISS.
 */
export class TtlCache {
  private readonly store = new Map<string, { value: unknown; expires: number }>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  hits = 0;
  misses = 0;

  constructor(private readonly now: () => number = () => Date.now()) {}

  async getOrLoad<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<{ value: T; hit: boolean }> {
    const entry = this.store.get(key);
    if (entry && entry.expires > this.now()) {
      this.hits++;
      return { value: entry.value as T, hit: true };
    }
    this.misses++;
    let pending = this.inflight.get(key) as Promise<T> | undefined;
    if (!pending) {
      pending = load().then(
        (value) => {
          this.store.set(key, { value, expires: this.now() + ttlMs });
          this.inflight.delete(key);
          return value;
        },
        (err: unknown) => {
          this.inflight.delete(key);
          throw err;
        },
      );
      this.inflight.set(key, pending);
    }
    return { value: await pending, hit: false };
  }

  /** Drop every key starting with prefix ("" clears all). Returns how many were dropped. */
  invalidate(prefix = ""): number {
    let n = 0;
    for (const key of [...this.store.keys()]) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        n++;
      }
    }
    return n;
  }
}
