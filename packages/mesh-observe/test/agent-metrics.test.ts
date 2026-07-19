import { describe, it, expect } from "vitest";
import { createAgentMetrics } from "../src/agent-metrics.js";
import type { AgentMetrics } from "../src/agent-metrics.js";
import type {
  Counter,
  Histogram,
  InstrumentOptions,
  Meter,
  MetricAttributes,
  UpDownCounter,
} from "../src/meter.js";

interface Recording {
  instrument: string;
  type: "counter" | "histogram" | "updown";
  value: number;
  attributes?: MetricAttributes;
}

/**
 * Fake meter that captures every recording for assertion.
 */
const createFakeMeter = (): { meter: Meter; recordings: Recording[] } => {
  const recordings: Recording[] = [];

  const meter: Meter = {
    createCounter(name: string, _options?: InstrumentOptions): Counter {
      return {
        add(value: number, attributes?: MetricAttributes) {
          recordings.push({ instrument: name, type: "counter", value, attributes });
        },
      };
    },
    createHistogram(name: string, _options?: InstrumentOptions): Histogram {
      return {
        record(value: number, attributes?: MetricAttributes) {
          recordings.push({ instrument: name, type: "histogram", value, attributes });
        },
      };
    },
    createUpDownCounter(name: string, _options?: InstrumentOptions): UpDownCounter {
      return {
        add(value: number, attributes?: MetricAttributes) {
          recordings.push({ instrument: name, type: "updown", value, attributes });
        },
      };
    },
  };

  return { meter, recordings };
};

describe("createAgentMetrics", () => {
  it("creates all expected counters and histograms", () => {
    const { meter } = createFakeMeter();
    const m: AgentMetrics = createAgentMetrics(meter);

    expect(m.requestsTotal).toBeDefined();
    expect(m.toolErrorsTotal).toBeDefined();
    expect(m.messagesProcessedTotal).toBeDefined();
    expect(m.llmLatencyMs).toBeDefined();
    expect(m.tokens).toBeDefined();
    expect(m.costUsd).toBeDefined();
  });

  it("counters record via the fake meter", () => {
    const { meter, recordings } = createFakeMeter();
    const m = createAgentMetrics(meter);

    m.requestsTotal.add(1, { "gen_ai.system": "openai" });
    m.toolErrorsTotal.add(1, { "gen_ai.tool.name": "search" });
    m.messagesProcessedTotal.add(5);

    expect(recordings).toHaveLength(3);
    expect(recordings[0]).toEqual({
      instrument: "gen_ai.agent.requests_total",
      type: "counter",
      value: 1,
      attributes: { "gen_ai.system": "openai" },
    });
    expect(recordings[1]).toEqual({
      instrument: "gen_ai.agent.tool_errors_total",
      type: "counter",
      value: 1,
      attributes: { "gen_ai.tool.name": "search" },
    });
    expect(recordings[2]).toEqual({
      instrument: "gen_ai.agent.messages_processed_total",
      type: "counter",
      value: 5,
      attributes: undefined,
    });
  });

  it("histograms record via the fake meter", () => {
    const { meter, recordings } = createFakeMeter();
    const m = createAgentMetrics(meter);

    m.llmLatencyMs.record(150, { "gen_ai.request.model": "claude-sonnet-4-20250514" });
    m.tokens.record(1200, { "gen_ai.system": "anthropic" });
    m.costUsd.record(0.003);

    expect(recordings).toHaveLength(3);
    expect(recordings[0]).toEqual({
      instrument: "gen_ai.agent.llm_latency",
      type: "histogram",
      value: 150,
      attributes: { "gen_ai.request.model": "claude-sonnet-4-20250514" },
    });
    expect(recordings[1]).toEqual({
      instrument: "gen_ai.agent.tokens",
      type: "histogram",
      value: 1200,
      attributes: { "gen_ai.system": "anthropic" },
    });
    expect(recordings[2]).toEqual({
      instrument: "gen_ai.agent.cost",
      type: "histogram",
      value: 0.003,
      attributes: undefined,
    });
  });
});
