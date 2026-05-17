import { describe, it, expect } from "vitest";
import { isSignificant } from "../src/experiments/significance.js";

describe("isSignificant", () => {
  it("detects significant difference with large effect", () => {
    const result = isSignificant(0.1, 0.3, 1000);
    expect(result.significant).toBe(true);
    expect(result.pValue).toBeLessThan(0.05);
    expect(result.zScore).toBeGreaterThan(0);
  });

  it("detects non-significant difference with small effect", () => {
    const result = isSignificant(0.5, 0.51, 50);
    expect(result.significant).toBe(false);
    expect(result.pValue).toBeGreaterThan(0.05);
  });

  it("returns not significant for equal rates", () => {
    const result = isSignificant(0.5, 0.5, 1000);
    expect(result.significant).toBe(false);
    expect(result.zScore).toBe(0);
  });

  it("respects custom confidence level", () => {
    // Use a case that's significant at 0.90 but not at 0.99
    const result90 = isSignificant(0.4, 0.5, 200, 0.90);
    const result99 = isSignificant(0.4, 0.5, 200, 0.99);
    expect(result90.significant).toBe(true);
    expect(result99.significant).toBe(false);
  });

  it("handles zero standard error", () => {
    const result = isSignificant(0, 0, 100);
    expect(result.significant).toBe(false);
    expect(result.pValue).toBe(1);
  });
});
