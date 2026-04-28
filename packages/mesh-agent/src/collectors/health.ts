import { cpus } from 'node:os';
import type { HealthReport } from '../types.js';

export class HealthCollector {
  private readonly productId: string;
  private interval: ReturnType<typeof setInterval> | null = null;
  private lastCpuUsage: NodeJS.CpuUsage | null = null;
  private lastCpuTime: number = 0;

  constructor(productId: string) {
    this.productId = productId;
  }

  collect(): HealthReport {
    const mem = process.memoryUsage();
    const report: HealthReport = {
      productId: this.productId,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memoryUsage: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal },
    };

    const cpuUsage = this.getCpuPercent();
    if (cpuUsage !== undefined) report.cpuUsage = cpuUsage;

    return report;
  }

  start(intervalMs: number, onCollect: (report: HealthReport) => void): void {
    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuTime = Date.now();
    this.interval = setInterval(() => {
      try { onCollect(this.collect()); } catch {}
    }, intervalMs);
    this.interval.unref();
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private getCpuPercent(): number | undefined {
    if (!this.lastCpuUsage) return undefined;
    const current = process.cpuUsage(this.lastCpuUsage);
    const elapsed = (Date.now() - this.lastCpuTime) * 1000;
    if (elapsed <= 0) return undefined;
    const numCpus = cpus().length || 1;
    const percent = ((current.user + current.system) / elapsed / numCpus) * 100;
    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuTime = Date.now();
    return Math.round(percent * 100) / 100;
  }
}
