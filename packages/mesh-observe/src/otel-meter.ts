import {
  metrics,
  type Attributes,
  type Counter as OTelCounter,
  type Histogram as OTelHistogram,
  type Meter as OTelApiMeter,
  type UpDownCounter as OTelUpDownCounter,
} from "@opentelemetry/api";
import type {
  Counter,
  Histogram,
  InstrumentOptions,
  Meter,
  MetricAttributes,
  UpDownCounter,
} from "./meter.js";

export interface OTelMeterConfig {
  /**
   * Logical meter name (shows up as `instrumentation.name` on every
   * metric). Usually a stable package id like "@corelay/mesh-core".
   */
  name: string;
  /**
   * Optional OpenTelemetry Meter. Defaults to
   * `metrics.getMeter(name)` which uses whatever provider the caller
   * has registered globally (Prometheus, OTLP, etc.).
   */
  meter?: OTelApiMeter;
}

/**
 * OpenTelemetry-backed Meter.
 *
 * Wraps the OTel API meter to conform to our Meter interface, stripping
 * null/undefined attributes before forwarding.
 */
export class OTelMeter implements Meter {
  private readonly meter: OTelApiMeter;

  constructor(config: OTelMeterConfig) {
    this.meter = config.meter ?? metrics.getMeter(config.name);
  }

  createCounter(name: string, options?: InstrumentOptions): Counter {
    const counter: OTelCounter = this.meter.createCounter(name, options);
    return {
      add(value, attributes) {
        counter.add(value, toOtelAttrs(attributes));
      },
    };
  }

  createHistogram(name: string, options?: InstrumentOptions): Histogram {
    const histogram: OTelHistogram = this.meter.createHistogram(name, options);
    return {
      record(value, attributes) {
        histogram.record(value, toOtelAttrs(attributes));
      },
    };
  }

  createUpDownCounter(
    name: string,
    options?: InstrumentOptions,
  ): UpDownCounter {
    const counter: OTelUpDownCounter = this.meter.createUpDownCounter(
      name,
      options,
    );
    return {
      add(value, attributes) {
        counter.add(value, toOtelAttrs(attributes));
      },
    };
  }
}

// Re-exported so callers can access global OTel metrics API if needed.
export { metrics as otelMetrics };

// ─── helpers ──────────────────────────────────────────────────────────

const toOtelAttrs = (attrs?: MetricAttributes): Attributes | undefined => {
  if (!attrs) return undefined;
  const out: Attributes = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    out[key] = value;
  }
  return out;
};
