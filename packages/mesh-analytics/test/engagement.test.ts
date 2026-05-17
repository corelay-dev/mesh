import { describe, it, expect } from "vitest";
import { InMemoryEngagementStore, type EngagementRecord } from "../src/tracker/engagement.js";

function makeRecord(overrides: Partial<EngagementRecord> = {}): EngagementRecord {
  return {
    messageId: "msg-1",
    campaignId: "camp-1",
    platform: "twitter",
    likes: 10,
    replies: 5,
    shares: 3,
    impressions: 1000,
    clickThroughRate: 0.02,
    measuredAt: new Date("2026-05-10"),
    ...overrides,
  };
}

describe("InMemoryEngagementStore", () => {
  it("records and retrieves by message", async () => {
    const store = new InMemoryEngagementStore();
    await store.record(makeRecord());
    const results = await store.getByMessage("msg-1");
    expect(results).toHaveLength(1);
    expect(results[0]!.likes).toBe(10);
  });

  it("retrieves by campaign", async () => {
    const store = new InMemoryEngagementStore();
    await store.record(makeRecord({ messageId: "msg-1" }));
    await store.record(makeRecord({ messageId: "msg-2", campaignId: "camp-2" }));
    const results = await store.getByCampaign("camp-1");
    expect(results).toHaveLength(1);
  });

  it("filters by date range", async () => {
    const store = new InMemoryEngagementStore();
    await store.record(makeRecord({ measuredAt: new Date("2026-05-01") }));
    await store.record(makeRecord({ messageId: "msg-2", measuredAt: new Date("2026-05-15") }));
    const results = await store.getByCampaign("camp-1", {
      from: new Date("2026-05-10"),
      to: new Date("2026-05-20"),
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.messageId).toBe("msg-2");
  });

  it("returns top performing sorted by engagement", async () => {
    const store = new InMemoryEngagementStore();
    await store.record(makeRecord({ messageId: "low", likes: 1, replies: 0, shares: 0 }));
    await store.record(makeRecord({ messageId: "high", likes: 100, replies: 50, shares: 30 }));
    await store.record(makeRecord({ messageId: "mid", likes: 20, replies: 10, shares: 5 }));
    const top = await store.getTopPerforming("camp-1", 2);
    expect(top).toHaveLength(2);
    expect(top[0]!.messageId).toBe("high");
    expect(top[1]!.messageId).toBe("mid");
  });
});
