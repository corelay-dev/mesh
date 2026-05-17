import type { PlatformAdapter, SocialEvent } from "../platforms/types.js";

export interface TrendReport {
  trends: Array<{ topic: string; volume: number; sentiment: number; relevance: number }>;
  scannedAt: Date;
}

export interface TrendScannerConfig {
  adapters: PlatformAdapter[];
  keywords: string[];
  interval: number;
  relevanceThreshold: number;
}

export class TrendScanner {
  private config: TrendScannerConfig;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(config: TrendScannerConfig) {
    this.config = config;
  }

  async scan(): Promise<TrendReport> {
    const events: SocialEvent[] = [];
    for (const adapter of this.config.adapters) {
      for await (const event of adapter.monitor(this.config.keywords)) {
        events.push(event);
      }
    }

    const topicMap = new Map<string, { volume: number; sentimentSum: number }>();
    for (const event of events) {
      for (const kw of this.config.keywords) {
        if (event.content.toLowerCase().includes(kw.toLowerCase())) {
          const existing = topicMap.get(kw) ?? { volume: 0, sentimentSum: 0 };
          existing.volume++;
          topicMap.set(kw, existing);
        }
      }
    }

    const trends = [...topicMap.entries()]
      .map(([topic, data]) => ({
        topic,
        volume: data.volume,
        sentiment: data.volume > 0 ? data.sentimentSum / data.volume : 0,
        relevance: Math.min(data.volume / 10, 1),
      }))
      .filter((t) => t.relevance >= this.config.relevanceThreshold);

    return { trends, scannedAt: new Date() };
  }

  start(): void {
    this.timer = setInterval(() => { void this.scan(); }, this.config.interval);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
