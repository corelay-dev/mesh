import { describe, it, expect, vi } from "vitest";
import { OTelMeter } from "../src/otel-meter.js";
import type { OTelMeterConfig } from "../src/otel-meter.js";

/**
 * Minimal OTel API stubs to verify our adapter forwards calls correctly.
 */
const createMockOTelMeter = () => {
  const mockCounter = { add: vi.fn() };
  const mockHistogram = { record: vi.fn() };
  const mockUpDownCounter = { add: vi.fn() };

  const otelMeter = {
    createCounter: vi.fn().mockReturnValue(mockCounter),
    createHistogram: vi.fn().mockReturnValue(mockHistogram),
    createUpDownCounter: vi.fn().mockReturnValue(mockUpDownCounter),
    createObservableCounter: vi.fn(),
    createObservableGauge: vi.fn(),
    createObservableUpDownCounter: vi.fn(),
    addBatchObservableCallback: vi.fn(),
    removeBatchObservableCallback: vi.fn(),
    createGauge: vi.fn(),
  };

  return { otelMeter, mockCounter, mockHistogram, mockUpDownCounter };
};

describe("OTelMeter", () => {
  it("delegates createCounter to the underlying OTel meter", () => {
    const { otelMeter, mockCounter } = createMockOTelMeter();
    const config: OTelMeterConfig = {
      name: "test",
      meter: otelMeter as never,
    };
    const meter = new OTelMeter(config);

    const counter = meter.createCounter("my.counter", {
      description: "desc",
      unit: "{req}",
    });
    counter.add(3, { env: "prod" });

    expect(otelMeter.createCounter).toHaveBeenCalledWith("my.counter", {
      description: "desc",
      unit: "{req}",
    });
    expect(mockCounter.add).toHaveBeenCalledWith(3, { env: "prod" });
  });

  it("delegates createHistogram to the underlying OTel meter", () => {
    const { otelMeter, mockHistogram } = createMockOTelMeter();
    const meter = new OTelMeter({ name: "test", meter: otelMeter as never });

    const histogram = meter.createHistogram("my.latency", { unit: "ms" });
    histogram.record(42, { model: "gpt-4o" });

    expect(otelMeter.createHistogram).toHaveBeenCalledWith("my.latency", {
      unit: "ms",
    });
    expect(mockHistogram.record).toHaveBeenCalledWith(42, { model: "gpt-4o" });
  });

  it("delegates createUpDownCounter to the underlying OTel meter", () => {
    const { otelMeter, mockUpDownCounter } = createMockOTelMeter();
    const meter = new OTelMeter({ name: "test", meter: otelMeter as never });

    const counter = meter.createUpDownCounter("active.connections");
    counter.add(-1, { service: "api" });

    expect(otelMeter.createUpDownCounter).toHaveBeenCalledWith(
      "active.connections",
      undefined,
    );
    expect(mockUpDownCounter.add).toHaveBeenCalledWith(-1, { service: "api" });
  });

  it("strips null and undefined attribute values before forwarding", () => {
    const { otelMeter, mockCounter } = createMockOTelMeter();
    const meter = new OTelMeter({ name: "test", meter: otelMeter as never });

    const counter = meter.createCounter("test.clean");
    counter.add(1, { a: "keep", b: undefined, c: null, d: 42 });

    expect(mockCounter.add).toHaveBeenCalledWith(1, { a: "keep", d: 42 });
  });

  it("passes undefined attributes when none provided", () => {
    const { otelMeter, mockHistogram } = createMockOTelMeter();
    const meter = new OTelMeter({ name: "test", meter: otelMeter as never });

    const histogram = meter.createHistogram("test.no_attrs");
    histogram.record(10);

    expect(mockHistogram.record).toHaveBeenCalledWith(10, undefined);
  });
});
