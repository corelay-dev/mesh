import { describe, it, expect } from "vitest";
import { noopMeter } from "../src/meter.js";
import type { Counter, Histogram, Meter, UpDownCounter } from "../src/meter.js";

/**
 * Contract tests for the Meter interface. Asserts that every implementation
 * produces instruments that can record without throwing.
 */
const runContract = (label: string, meter: Meter) => {
  describe(`Meter contract: ${label}`, () => {
    it("createCounter returns a Counter that accepts add()", () => {
      const counter: Counter = meter.createCounter("test.counter", {
        description: "test counter",
        unit: "{request}",
      });
      expect(() => counter.add(1)).not.toThrow();
      expect(() => counter.add(5, { env: "test" })).not.toThrow();
    });

    it("createHistogram returns a Histogram that accepts record()", () => {
      const histogram: Histogram = meter.createHistogram("test.histogram", {
        description: "test histogram",
        unit: "ms",
      });
      expect(() => histogram.record(42)).not.toThrow();
      expect(() => histogram.record(100, { model: "gpt-4o" })).not.toThrow();
    });

    it("createUpDownCounter returns an UpDownCounter that accepts add() with negative values", () => {
      const counter: UpDownCounter = meter.createUpDownCounter(
        "test.up_down",
        { description: "test up-down counter" },
      );
      expect(() => counter.add(1)).not.toThrow();
      expect(() => counter.add(-1)).not.toThrow();
      expect(() => counter.add(3, { queue: "main" })).not.toThrow();
    });

    it("instruments tolerate null/undefined attribute values", () => {
      const counter = meter.createCounter("test.null_attrs");
      expect(() =>
        counter.add(1, { a: "ok", b: undefined, c: null }),
      ).not.toThrow();
    });
  });
};

runContract("noopMeter", noopMeter);
