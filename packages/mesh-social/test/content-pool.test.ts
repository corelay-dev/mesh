import { describe, it, expect } from "vitest";
import { InMemoryContentPool, type ContentPoolItem } from "../src/scheduler/content-pool.js";

function makeItem(overrides: Partial<ContentPoolItem> = {}): ContentPoolItem {
  return {
    id: crypto.randomUUID(),
    campaignId: "camp-1",
    content: "test content",
    platform: "twitter",
    language: "en",
    createdAt: new Date(),
    priority: 1,
    ...overrides,
  };
}

describe("InMemoryContentPool", () => {
  it("adds and retrieves items", () => {
    const pool = new InMemoryContentPool();
    pool.add(makeItem({ platform: "twitter" }));
    expect(pool.size()).toBe(1);
    expect(pool.size("twitter")).toBe(1);
  });

  it("getNext returns highest priority item for platform", () => {
    const pool = new InMemoryContentPool();
    pool.add(makeItem({ priority: 1, content: "low" }));
    pool.add(makeItem({ priority: 5, content: "high" }));
    const item = pool.getNext("twitter");
    expect(item?.content).toBe("high");
  });

  it("getNext removes item from pool", () => {
    const pool = new InMemoryContentPool();
    pool.add(makeItem());
    pool.getNext("twitter");
    expect(pool.size()).toBe(0);
  });

  it("getNext returns undefined for empty platform", () => {
    const pool = new InMemoryContentPool();
    pool.add(makeItem({ platform: "twitter" }));
    expect(pool.getNext("facebook")).toBeUndefined();
  });

  it("size returns total when no platform specified", () => {
    const pool = new InMemoryContentPool();
    pool.add(makeItem({ platform: "twitter" }));
    pool.add(makeItem({ platform: "facebook" }));
    expect(pool.size()).toBe(2);
  });

  it("drain returns requested count", () => {
    const pool = new InMemoryContentPool();
    pool.add(makeItem());
    pool.add(makeItem());
    pool.add(makeItem());
    const drained = pool.drain("twitter", 2);
    expect(drained).toHaveLength(2);
    expect(pool.size()).toBe(1);
  });

  it("drain returns available items if less than requested", () => {
    const pool = new InMemoryContentPool();
    pool.add(makeItem());
    const drained = pool.drain("twitter", 5);
    expect(drained).toHaveLength(1);
  });
});
