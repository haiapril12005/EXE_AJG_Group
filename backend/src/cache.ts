/** A small least-recently-used map; reading an entry makes it the last one evicted. */
export class LruCache<K, V> {
  private readonly items = new Map<K, V>();
  private readonly limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  get(key: K): V | undefined {
    if (!this.items.has(key)) return undefined;
    const value = this.items.get(key) as V;
    this.items.delete(key);
    this.items.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    this.items.delete(key);
    this.items.set(key, value);
    for (const oldest of this.items.keys()) {
      if (this.items.size <= this.limit) break;
      this.items.delete(oldest);
    }
  }

  delete(key: K): void {
    this.items.delete(key);
  }

  get size(): number {
    return this.items.size;
  }
}
