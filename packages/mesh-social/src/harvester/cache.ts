interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class ScanCache<T = unknown> {
  private store = new Map<string, CacheEntry<T>>();

  has(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  set(key: string, value: T, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  get(key: string): T | undefined {
    if (!this.has(key)) return undefined;
    return this.store.get(key)!.value;
  }
}
