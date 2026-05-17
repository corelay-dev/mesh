import { describe, it, expect } from "vitest";
import { resolveConflicts } from "../src/scheduler/conflict-resolver.js";
import type { ContentSlot } from "../src/scheduler/calendar.js";

function makeSlot(overrides: Partial<ContentSlot> = {}): ContentSlot {
  return {
    id: crypto.randomUUID(),
    platform: "twitter",
    scheduledAt: new Date("2026-05-13T08:00:00"),
    content: "test",
    status: "pending",
    campaignId: "camp-1",
    ...overrides,
  };
}

describe("resolveConflicts", () => {
  it("returns slots unchanged when no conflicts", () => {
    const slots = [
      makeSlot({ scheduledAt: new Date("2026-05-13T08:00:00") }),
      makeSlot({ scheduledAt: new Date("2026-05-13T12:00:00") }),
    ];
    const result = resolveConflicts(slots);
    expect(result).toHaveLength(2);
    expect(result[0]!.scheduledAt.getTime()).toBe(slots[0]!.scheduledAt.getTime());
    expect(result[1]!.scheduledAt.getTime()).toBe(slots[1]!.scheduledAt.getTime());
  });

  it("adjusts slots that are within 2 hours of each other on same platform", () => {
    const slots = [
      makeSlot({ scheduledAt: new Date("2026-05-13T08:00:00") }),
      makeSlot({ scheduledAt: new Date("2026-05-13T08:30:00") }),
    ];
    const result = resolveConflicts(slots);
    expect(result).toHaveLength(2);
    const diff = result[1]!.scheduledAt.getTime() - result[0]!.scheduledAt.getTime();
    expect(diff).toBeGreaterThanOrEqual(2 * 60 * 60 * 1000);
  });

  it("does not adjust slots on different platforms", () => {
    const slots = [
      makeSlot({ platform: "twitter", scheduledAt: new Date("2026-05-13T08:00:00") }),
      makeSlot({ platform: "facebook", scheduledAt: new Date("2026-05-13T08:30:00") }),
    ];
    const result = resolveConflicts(slots);
    expect(result[1]!.scheduledAt.getTime()).toBe(slots[1]!.scheduledAt.getTime());
  });

  it("handles multiple conflicts in sequence", () => {
    const slots = [
      makeSlot({ scheduledAt: new Date("2026-05-13T08:00:00") }),
      makeSlot({ scheduledAt: new Date("2026-05-13T08:10:00") }),
      makeSlot({ scheduledAt: new Date("2026-05-13T08:20:00") }),
    ];
    const result = resolveConflicts(slots);
    for (let i = 1; i < result.length; i++) {
      const diff = result[i]!.scheduledAt.getTime() - result[i - 1]!.scheduledAt.getTime();
      expect(diff).toBeGreaterThanOrEqual(2 * 60 * 60 * 1000);
    }
  });
});
