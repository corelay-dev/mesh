import type { PlatformAdapter, SocialEvent } from "../platforms/types.js";

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_SEEN = 10_000;

export class SocialMonitor {
  private adapters: PlatformAdapter[];
  private intervalMs: number;
  private maxSeen: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private seen = new Map<string, number>(); // id → timestamp

  constructor(adapters: PlatformAdapter[], intervalMs = DEFAULT_INTERVAL_MS, maxSeen = DEFAULT_MAX_SEEN) {
    this.adapters = adapters;
    this.intervalMs = intervalMs;
    this.maxSeen = maxSeen;
  }

  watch(keywords: string[], callback: (event: SocialEvent) => void): void {
    const poll = async () => {
      for (const adapter of this.adapters) {
        try {
          for await (const event of adapter.monitor(keywords)) {
            if (!this.seen.has(event.id)) {
              this.seen.set(event.id, Date.now());
              this.evictIfNeeded();
              callback(event);
            }
          }
        } catch (err) {
          // Log but don't crash the monitor loop
          console.error(`[SocialMonitor] adapter error:`, err instanceof Error ? err.message : err);
        }
      }
    };

    // Run immediately, then on interval
    void poll();
    this.timer = setInterval(() => void poll(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Evict oldest entries when seen-set exceeds max size */
  private evictIfNeeded(): void {
    if (this.seen.size <= this.maxSeen) return;

    const entries = [...this.seen.entries()].sort((a, b) => a[1] - b[1]);
    const toRemove = entries.slice(0, this.seen.size - this.maxSeen + 1000); // Remove 1000 extra to avoid frequent eviction
    for (const [key] of toRemove) {
      this.seen.delete(key);
    }
  }
}
