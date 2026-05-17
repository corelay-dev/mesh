export interface CorelayConfig {
  commandCenterUrl: string;
  productId: string;
  apiKey?: string;
  heartbeatInterval?: number;
  flushInterval?: number;
  enabled?: boolean;
}

export interface HealthReport {
  productId: string;
  timestamp: string;
  uptime: number;
  memoryUsage: { rss: number; heapUsed: number; heapTotal: number };
  cpuUsage?: number;
  version?: string;
}

export interface ErrorReport {
  productId: string;
  timestamp: string;
  error: string;
  stack?: string;
  context?: Record<string, unknown>;
}

export interface MetricReport {
  productId: string;
  timestamp: string;
  name: string;
  value: number;
  tags?: Record<string, string>;
}

export interface LLMUsageReport {
  productId: string;
  timestamp: string;
  provider: 'openai' | 'bedrock' | 'anthropic';
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
  feature?: string;
}

export interface RequestMetric {
  productId: string;
  timestamp: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
}

export interface TelemetryPayload {
  health?: HealthReport;
  errors: ErrorReport[];
  metrics: MetricReport[];
  llmUsage: LLMUsageReport[];
  requests: RequestMetric[];
}
