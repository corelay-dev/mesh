import { describe, it, expect } from "vitest";
import { computeCost, BudgetTracker, DEFAULT_PRICING } from "../src/pricing.js";
import { BudgetExceededError } from "../src/types.js";
import type { TokenUsageExt } from "../src/types.js";

describe("computeCost", () => {
  it("computes cost for a known model", () => {
    const usage: TokenUsageExt = {
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
    };
    const cost = computeCost(usage, "gpt-4o");
    // input: 1000/1M * 2.5 = 0.0025, output: 500/1M * 10 = 0.005
    expect(cost).toBeCloseTo(0.0075, 8);
  });

  it("returns undefined for an unknown model", () => {
    const usage: TokenUsageExt = {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    };
    expect(computeCost(usage, "unknown-model-xyz")).toBeUndefined();
  });

  it("accounts for cached tokens at reduced rate", () => {
    const usage: TokenUsageExt = {
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
      cachedTokens: 800,
    };
    const cost = computeCost(usage, "gpt-4o");
    // uncached input: 200/1M * 2.5 = 0.0005
    // cached input: 800/1M * 1.25 = 0.001
    // output: 500/1M * 10 = 0.005
    expect(cost).toBeCloseTo(0.0065, 8);
  });

  it("uses custom pricing table when provided", () => {
    const usage: TokenUsageExt = {
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
      totalTokens: 2_000_000,
    };
    const custom = { "my-model": { inputPerMillion: 1, outputPerMillion: 2 } };
    expect(computeCost(usage, "my-model", custom)).toBeCloseTo(3.0, 8);
  });

  it("defaults cachedInputPerMillion to inputPerMillion when not specified", () => {
    const usage: TokenUsageExt = {
      promptTokens: 1000,
      completionTokens: 0,
      totalTokens: 1000,
      cachedTokens: 1000,
    };
    const custom = { "test-model": { inputPerMillion: 5, outputPerMillion: 10 } };
    // All tokens cached, rate = inputPerMillion since cachedInputPerMillion is absent
    expect(computeCost(usage, "test-model", custom)).toBeCloseTo(0.005, 8);
  });

  it("has pricing entries for common models", () => {
    expect(DEFAULT_PRICING["gpt-4o"]).toBeDefined();
    expect(DEFAULT_PRICING["claude-3-5-sonnet-latest"]).toBeDefined();
    expect(DEFAULT_PRICING["anthropic.claude-3-5-sonnet-20241022-v2:0"]).toBeDefined();
  });
});

describe("BudgetTracker", () => {
  it("tracks cumulative spend", () => {
    const tracker = new BudgetTracker({ maxCostUsd: 1.0 });
    tracker.record(0.3);
    tracker.record(0.2);
    expect(tracker.currentSpend).toBeCloseTo(0.5);
    expect(tracker.remaining).toBeCloseTo(0.5);
  });

  it("throws BudgetExceededError when budget is exceeded", () => {
    const tracker = new BudgetTracker({ maxCostUsd: 0.5 });
    tracker.record(0.3);
    expect(() => tracker.record(0.3)).toThrow(BudgetExceededError);
  });

  it("includes spent and limit in the error", () => {
    const tracker = new BudgetTracker({ maxCostUsd: 0.1 });
    try {
      tracker.record(0.2);
    } catch (err) {
      expect(err).toBeInstanceOf(BudgetExceededError);
      const e = err as BudgetExceededError;
      expect(e.spent).toBeCloseTo(0.2);
      expect(e.limit).toBeCloseTo(0.1);
    }
  });

  it("resets cumulative spend", () => {
    const tracker = new BudgetTracker({ maxCostUsd: 1.0 });
    tracker.record(0.8);
    tracker.reset();
    expect(tracker.currentSpend).toBe(0);
    expect(tracker.remaining).toBe(1.0);
  });
});
