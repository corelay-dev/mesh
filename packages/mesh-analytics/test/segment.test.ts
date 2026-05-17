import { describe, it, expect } from "vitest";
import { createSegments, createSegmentByWard, type Supporter } from "../src/experiments/segment.js";

describe("createSegments", () => {
  it("splits supporters into N segments", () => {
    const supporters: Supporter[] = Array.from({ length: 100 }, (_, i) => ({ id: `s-${i}` }));
    const segments = createSegments(supporters, 4);
    expect(segments).toHaveLength(4);
    const allIds = segments.flatMap((s) => s.supporterIds);
    expect(allIds).toHaveLength(100);
    expect(new Set(allIds).size).toBe(100);
  });

  it("handles uneven splits", () => {
    const supporters: Supporter[] = Array.from({ length: 10 }, (_, i) => ({ id: `s-${i}` }));
    const segments = createSegments(supporters, 3);
    expect(segments).toHaveLength(3);
    const total = segments.reduce((s, seg) => s + seg.size, 0);
    expect(total).toBe(10);
  });

  it("sets size correctly", () => {
    const supporters: Supporter[] = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    const segments = createSegments(supporters, 2);
    for (const seg of segments) {
      expect(seg.size).toBe(seg.supporterIds.length);
    }
  });
});

describe("createSegmentByWard", () => {
  it("filters supporters by ward", () => {
    const supporters: Supporter[] = [
      { id: "s1", ward: "Kano" },
      { id: "s2", ward: "Lagos" },
      { id: "s3", ward: "Kano" },
      { id: "s4", ward: "Abuja" },
    ];
    const segment = createSegmentByWard(supporters, "Kano");
    expect(segment.supporterIds).toHaveLength(2);
    expect(segment.supporterIds).toContain("s1");
    expect(segment.supporterIds).toContain("s3");
    expect(segment.name).toBe("Ward: Kano");
    expect(segment.size).toBe(2);
  });

  it("returns empty segment for unknown ward", () => {
    const supporters: Supporter[] = [{ id: "s1", ward: "Lagos" }];
    const segment = createSegmentByWard(supporters, "Unknown");
    expect(segment.supporterIds).toHaveLength(0);
    expect(segment.size).toBe(0);
  });
});
