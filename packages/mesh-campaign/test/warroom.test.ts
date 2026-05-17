import { describe, it, expect } from "vitest";
import { detectAnomaly } from "../src/warroom/service.js";

describe("warroom/detectAnomaly", () => {
  it("flags votes exceeding accredited voters", () => {
    const result = detectAnomaly({ APC: 200, PDP: 150 }, 300, 500);
    expect(result.isAnomaly).toBe(true);
    expect(result.reason).toContain("exceed accredited");
  });

  it("flags suspiciously high turnout", () => {
    const result = detectAnomaly({ APC: 400, PDP: 50 }, 480, 500);
    expect(result.isAnomaly).toBe(true);
    expect(result.reason).toContain("high turnout");
  });

  it("flags single party dominance (ballot stuffing)", () => {
    const result = detectAnomaly({ APC: 470, PDP: 15, LP: 15 }, 600, 800);
    expect(result.isAnomaly).toBe(true);
    expect(result.reason).toContain("ballot stuffing");
  });

  it("passes normal results", () => {
    const result = detectAnomaly({ APC: 150, PDP: 120, LP: 80 }, 400, 600);
    expect(result.isAnomaly).toBe(false);
    expect(result.reason).toBeNull();
  });

  it("skips check for very small polling units", () => {
    const result = detectAnomaly({ APC: 40, PDP: 5 }, 50, 100);
    expect(result.isAnomaly).toBe(false);
  });
});
