import {
  context,
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
  type Tracer as OTelApiTracer,
} from "@opentelemetry/api";
import type { SpanAttributes, SpanContext, Tracer } from "./tracer.js";

export interface OTelTracerConfig {
  /**
   * Logical tracer name (shows up as `instrumentation.name` on every
   * span). Usually a stable package id like "@corelay/mesh-core".
   */
  name: string;
  /**
   * Optional OpenTelemetry Tracer. Defaults to
   * `trace.getTracer(name)` which uses whatever provider the caller
   * has registered globally (Honeycomb, Tempo, console, etc.).
   */
  tracer?: OTelApiTracer;
}

/**
 * OpenTelemetry-backed Tracer.
 *
 * Uses `startActiveSpan` so nested `tracer.span` calls automatically become
 * children via the global context. No manual plumbing of span objects
 * through Mesh code — this is the whole point of the abstraction.
 */
export class OTelTracer implements Tracer {
  private readonly tracer: OTelApiTracer;

  constructor(config: OTelTracerConfig) {
    this.tracer = config.tracer ?? trace.getTracer(config.name);
  }

  async span<T>(
    name: string,
    attributes: SpanAttributes,
    fn: (ctx: SpanContext) => Promise<T>,
  ): Promise<T> {
    return this.tracer.startActiveSpan(
      name,
      { attributes: toOtelAttrs(attributes) },
      async (span) => {
        try {
          const result = await fn(ctxFor(span));
          span.end();
          return result;
        } catch (err) {
          span.recordException(asError(err));
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: err instanceof Error ? err.message : String(err),
          });
          span.end();
          throw err;
        }
      },
    );
  }
}

// Re-exported so callers can pass a custom OTel context when integrating
// with manually-instrumented code that already has a parent span.
export { context as otelContext, trace as otelTrace };

// ─── helpers ──────────────────────────────────────────────────────────

const toOtelAttrs = (attrs: SpanAttributes): Attributes => {
  const out: Attributes = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    out[key] = value;
  }
  return out;
};

const ctxFor = (span: Span): SpanContext => ({
  setAttribute(key, value) {
    if (value === undefined || value === null) return;
    span.setAttribute(key, value);
  },
  setAttributes(attrs) {
    span.setAttributes(toOtelAttrs(attrs));
  },
  recordException(err) {
    span.recordException(asError(err));
  },
  setStatus(status, message) {
    span.setStatus({
      code: status === "ok" ? SpanStatusCode.OK : SpanStatusCode.ERROR,
      ...(message !== undefined && { message }),
    });
  },
});

const asError = (err: unknown): Error =>
  err instanceof Error ? err : new Error(String(err));
