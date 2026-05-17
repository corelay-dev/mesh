import { describe, it, expect } from "vitest";
import { filterByRelevance } from "../src/harvester/relevance-filter.js";
import type { SocialEvent } from "../src/platforms/types.js";

function makeEvent(content: string): SocialEvent {
  return {
    id: crypto.randomUUID(),
    platform: "twitter",
    type: "post",
    author: "user1",
    content,
    createdAt: new Date(),
  };
}

describe("filterByRelevance", () => {
  it("returns events matching keywords above threshold", () => {
    const events = [
      makeEvent("This is about education and healthcare"),
      makeEvent("Random unrelated content"),
    ];
    const result = filterByRelevance(events, ["education", "healthcare"], 0.3);
    expect(result).toHaveLength(1);
    expect(result[0]!.content).toContain("education");
  });

  it("uses default threshold of 0.3", () => {
    const events = [
      makeEvent("education is important"),
      makeEvent("nothing relevant here"),
    ];
    const result = filterByRelevance(events, ["education", "healthcare", "policy"]);
    expect(result).toHaveLength(1);
  });

  it("returns empty array when no events match", () => {
    const events = [makeEvent("completely unrelated")];
    const result = filterByRelevance(events, ["education", "healthcare"]);
    expect(result).toHaveLength(0);
  });

  it("is case-insensitive", () => {
    const events = [makeEvent("EDUCATION matters")];
    const result = filterByRelevance(events, ["education"]);
    expect(result).toHaveLength(1);
  });

  it("returns all events when all match", () => {
    const events = [
      makeEvent("education and healthcare"),
      makeEvent("healthcare reform"),
    ];
    const result = filterByRelevance(events, ["healthcare"], 0.5);
    expect(result).toHaveLength(2);
  });

  it("returns empty for empty keywords", () => {
    const events = [makeEvent("anything")];
    const result = filterByRelevance(events, []);
    expect(result).toHaveLength(0);
  });
});
