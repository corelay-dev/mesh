import { describe, it, expect } from "vitest";
import { generateFeedbackContext } from "../src/feedback/loop.js";
import { InMemoryEngagementStore } from "../src/tracker/engagement.js";
import { InMemoryRuleStore } from "../src/reflection/update-prompt.js";

describe("feedback/loop", () => {
  it("generates context with top performing content", async () => {
    const engagementStore = new InMemoryEngagementStore();
    const ruleStore = new InMemoryRuleStore();
    const campaignId = "campaign-1";

    engagementStore.record({
      messageId: "msg-1", campaignId, platform: "twitter",
      likes: 100, replies: 20, shares: 50, impressions: 5000, clickThroughRate: 0.05, measuredAt: new Date(),
    });
    engagementStore.record({
      messageId: "msg-2", campaignId, platform: "whatsapp",
      likes: 10, replies: 80, shares: 5, impressions: 200, clickThroughRate: 0.1, measuredAt: new Date(),
    });

    const context = await generateFeedbackContext(campaignId, engagementStore, ruleStore);

    expect(context.length).toBeGreaterThan(0);
    expect(context.some((c) => c.includes("Top performing"))).toBe(true);
    expect(context.some((c) => c.includes("Channel performance"))).toBe(true);
  });

  it("includes learned rules with sufficient confidence", async () => {
    const engagementStore = new InMemoryEngagementStore();
    const ruleStore = new InMemoryRuleStore();
    const campaignId = "campaign-1";

    await ruleStore.addRule({
      id: "rule-1", campaignId, rule: "Use Pidgin for grassroots messaging",
      confidence: 0.8, source: "msg-1", createdAt: new Date(), lastApplied: null, applicationCount: 0,
    });
    await ruleStore.addRule({
      id: "rule-2", campaignId, rule: "Low confidence rule",
      confidence: 0.3, source: "msg-2", createdAt: new Date(), lastApplied: null, applicationCount: 0,
    });

    const context = await generateFeedbackContext(campaignId, engagementStore, ruleStore);

    expect(context.some((c) => c.includes("Pidgin"))).toBe(true);
    expect(context.some((c) => c.includes("Low confidence"))).toBe(false);
  });

  it("returns empty array when no data exists", async () => {
    const engagementStore = new InMemoryEngagementStore();
    const ruleStore = new InMemoryRuleStore();

    const context = await generateFeedbackContext("empty-campaign", engagementStore, ruleStore);
    expect(context).toEqual([]);
  });
});
