import { HealthCollector } from './collectors/health.js';
import { ErrorCollector } from './collectors/errors.js';
import { LLMTracker } from './collectors/llm.js';
import { RequestTracker } from './collectors/requests.js';
import { HttpTransport } from './transports/http.js';
import { register } from './register.js';
import type {
  CorelayConfig,
  HealthReport,
  ErrorReport,
  MetricReport,
  LLMUsageReport,
  RequestMetric,
  TelemetryPayload,
} from './types.js';

export type {
  CorelayConfig,
  HealthReport,
  ErrorReport,
  MetricReport,
  LLMUsageReport,
  RequestMetric,
  TelemetryPayload,
};

export class CorelayAgent {
  private readonly config: Required<CorelayConfig>;
  private readonly health: HealthCollector;
  private readonly errors: ErrorCollector;
  private readonly llm: LLMTracker;
  private readonly requests: RequestTracker;
  private readonly transport: HttpTransport;
  private latestHealth: HealthReport | undefined;
  private metrics: MetricReport[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: CorelayConfig) {
    this.config = {
      commandCenterUrl: config.commandCenterUrl,
      productId: config.productId,
      apiKey: config.apiKey ?? '',
      heartbeatInterval: config.heartbeatInterval ?? 30_000,
      flushInterval: config.flushInterval ?? 10_000,
      enabled: config.enabled ?? true,
    };
    this.health = new HealthCollector(this.config.productId);
    this.errors = new ErrorCollector(this.config.productId);
    this.llm = new LLMTracker(this.config.productId);
    this.requests = new RequestTracker(this.config.productId);
    this.transport = new HttpTransport(this.config.commandCenterUrl, this.config.apiKey || undefined);
  }

  start(): void {
    if (!this.config.enabled) return;

    this.health.start(this.config.heartbeatInterval, (report) => {
      this.latestHealth = report;
    });
    this.errors.start();

    this.flushTimer = setInterval(() => { this.flush(); }, this.config.flushInterval);
    this.flushTimer.unref();

    register(this.config.commandCenterUrl, this.config.productId, this.config.apiKey || undefined).catch(() => {});
  }

  async stop(): Promise<void> {
    this.health.stop();
    this.errors.stop();
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }

  trackError(error: Error | string, context?: Record<string, unknown>): void {
    if (!this.config.enabled) return;
    this.errors.addError(error, context);
  }

  trackMetric(name: string, value: number, tags?: Record<string, string>): void {
    if (!this.config.enabled) return;
    this.metrics.push({
      productId: this.config.productId,
      timestamp: new Date().toISOString(),
      name,
      value,
      tags,
    });
  }

  trackLLM(
    provider: LLMUsageReport['provider'],
    model: string,
    inputTokens: number,
    outputTokens: number,
    costUsd: number,
    durationMs: number,
    feature?: string,
  ): void {
    if (!this.config.enabled) return;
    this.llm.trackCall(provider, model, inputTokens, outputTokens, costUsd, durationMs, feature);
  }

  expressMiddleware(): ReturnType<RequestTracker['expressMiddleware']> {
    return this.requests.expressMiddleware();
  }

  wrapBedrock<T extends object>(client: T): T {
    return this.llm.wrapBedrock(client);
  }

  wrapOpenAI<T extends object>(client: T): T {
    return this.llm.wrapOpenAI(client);
  }

  private async flush(): Promise<void> {
    try {
      const payload: TelemetryPayload = {
        health: this.latestHealth,
        errors: this.errors.flush(),
        metrics: this.metrics.splice(0),
        llmUsage: this.llm.flush(),
        requests: this.requests.flush(),
      };
      const hasData = payload.health
        || payload.errors.length > 0
        || payload.metrics.length > 0
        || payload.llmUsage.length > 0
        || payload.requests.length > 0;
      if (!hasData) return;
      this.latestHealth = undefined;
      await this.transport.send(payload);
    } catch {}
  }
}

export function init(config: CorelayConfig): CorelayAgent {
  return new CorelayAgent(config);
}
