/**
 * Attribute values allowed on metric recordings. Same shape as SpanAttributes
 * for consistency across the observe package.
 */
export type MetricAttributes = Record<
  string,
  string | number | boolean | undefined | null
>;

/**
 * A monotonically increasing counter. Records only non-negative increments.
 */
export interface Counter {
  add(value: number, attributes?: MetricAttributes): void;
}

/**
 * Records a distribution of values (latency, size, cost, etc.).
 */
export interface Histogram {
  record(value: number, attributes?: MetricAttributes): void;
}

/**
 * A counter that can go up or down (e.g. active connections, queue depth).
 */
export interface UpDownCounter {
  add(value: number, attributes?: MetricAttributes): void;
}

/**
 * The meter API consumed by instrumented Mesh primitives.
 *
 * Mirrors the Tracer pattern: a minimal interface with a no-op default so
 * instrumented code always has the same shape regardless of whether a real
 * backend is attached.
 */
export interface Meter {
  createCounter(name: string, options?: InstrumentOptions): Counter;
  createHistogram(name: string, options?: InstrumentOptions): Histogram;
  createUpDownCounter(name: string, options?: InstrumentOptions): UpDownCounter;
}

export interface InstrumentOptions {
  description?: string;
  unit?: string;
}

/**
 * Default meter. Creates instruments that record nothing. Used by
 * instrumented primitives when the caller doesn't supply a real meter —
 * means "no instrumentation" is the same code path as instrumented code,
 * just cheaper.
 */
export const noopMeter: Meter = {
  createCounter(_name, _options) {
    return { add() {} };
  },
  createHistogram(_name, _options) {
    return { record() {} };
  },
  createUpDownCounter(_name, _options) {
    return { add() {} };
  },
};
