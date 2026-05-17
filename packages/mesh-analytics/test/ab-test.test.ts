import { describe, it, expect } from "vitest";
import { createABTest, concludeTest, type ABTestConfig, type EngagementRecord } from "../src/index.js";

describe("createABTest", () => {
  it("creates a test with running status", () => {
    const config: ABTestConfig = {
      campaignId: "camp-1",
      hypothesis: "Shorter messages get more engagement",
      variants: [
        { id: "v1", content: "Short msg", platform: "whatsapp", segment: "seg-1" },
        { id: "v2", content: "A longer message with more detail", platform: "whatsapp", segment: "seg-2" },
      ],
    };
    const test = createABTest(config);
    expect(test.status).toBe("running");
    expect(test.campaignId).toBe("camp-1");
    expect(test.variants).toHaveLength(2);
    expect(test.id).toBeDefined();
    expect(test.startedAt).toBeInstanceOf(Date);
  });
});

describe("concludeTest", () => {
  it("picks the variant with highest engagement as winner", () => {
    const test = createABTest({
      campaignId: "camp-1",
      hypothesis: "Test",
      variants: [
        { id: "v1", content: "A", platform: "twitter", segment: "s1" },
        { id: "v2", content: "B", platform: "twitter", segment: "s2" },
      ],
    });

    const engagementData: EngagementRecord[] = [
      { messageId: "v1", campaignId: "camp-1", platform: "twitter", likes: 5, replies: 2, shares: 1, impressions: 100, clickThroughRate: 0.01, measuredAt: new Date() },
      { messageId: "v2", campaignId: "camp-1", platform: "twitter", likes: 50, replies: 20, shares: 10, impressions: 100, clickThroughRate: 0.05, measuredAt: new Date() },
    ];

    const result = concludeTest(test, engagementData);
    expect(result.status).toBe("concluded");
    expect(result.winner).toBe("v2");
    expect(result.concludedAt).toBeInstanceOf(Date);
  });
});
