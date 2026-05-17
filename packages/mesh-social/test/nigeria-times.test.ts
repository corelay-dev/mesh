import { describe, it, expect } from "vitest";
import { isOptimalTime, getNextOptimalTime } from "../src/scheduler/nigeria-times.js";

describe("isOptimalTime", () => {
  it("returns true for weekday morning 8am", () => {
    // Wednesday 8am
    const date = new Date("2026-05-13T08:00:00");
    expect(isOptimalTime("twitter", date)).toBe(true);
  });

  it("returns true for evening 20:00", () => {
    // Tuesday 8pm
    const date = new Date("2026-05-12T20:00:00");
    expect(isOptimalTime("twitter", date)).toBe(true);
  });

  it("returns false for Friday 1pm (prayers)", () => {
    // Friday 1pm
    const date = new Date("2026-05-15T13:00:00");
    expect(isOptimalTime("twitter", date)).toBe(false);
  });

  it("returns false for Sunday 9am (church)", () => {
    // Sunday 9am
    const date = new Date("2026-05-17T09:00:00");
    expect(isOptimalTime("twitter", date)).toBe(false);
  });

  it("returns false for 3am (off-peak)", () => {
    const date = new Date("2026-05-13T03:00:00");
    expect(isOptimalTime("twitter", date)).toBe(false);
  });

  it("returns false for unknown platform", () => {
    const date = new Date("2026-05-13T08:00:00");
    expect(isOptimalTime("tiktok", date)).toBe(false);
  });
});

describe("getNextOptimalTime", () => {
  it("returns a time in the future", () => {
    const after = new Date("2026-05-13T03:00:00");
    const result = getNextOptimalTime("twitter", after);
    expect(result.getTime()).toBeGreaterThan(after.getTime());
  });

  it("returns an optimal time", () => {
    const after = new Date("2026-05-13T03:00:00");
    const result = getNextOptimalTime("twitter", after);
    expect(isOptimalTime("twitter", result)).toBe(true);
  });

  it("skips Friday prayer time", () => {
    // Start at Friday 12:59
    const after = new Date("2026-05-15T12:59:00");
    const result = getNextOptimalTime("twitter", after);
    // Should not be during 13-15 on Friday
    const day = result.getDay();
    const hour = result.getHours();
    if (day === 5) {
      expect(hour < 13 || hour >= 15).toBe(true);
    }
  });
});
