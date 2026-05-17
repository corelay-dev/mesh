import { describe, it, expect } from "vitest";
import { handleStrategyRequest, type StrategyAgentDeps } from "../src/agents/strategy.js";
import type { LLMClient } from "@corelay/mesh-core";

describe("agents/strategy", () => {
  const campaignId = "00000000-0000-0000-0000-000000000001";

  it("generates ward targeting from historical + supporter data", async () => {
    const wardPriority = {
      wards: [
        { ward: "Tumfure", lga: "Akko", priority: "critical", strategy: "Door-to-door canvassing", estimatedSwingVotes: 1200 },
        { ward: "Kumo Central", lga: "Akko", priority: "high", strategy: "Rally + WhatsApp blast", estimatedSwingVotes: 800 },
      ],
      overallStrategy: "Focus on Akko LGA swing wards with ground game",
    };

    const deps: StrategyAgentDeps = {
      llm: { chat: async () => ({ content: JSON.stringify(wardPriority), inputTokens: 200, outputTokens: 300 }) },
      getCampaign: async () => ({ candidateName: "Musa", state: "Gombe", partyCode: "PDP" }),
      getHistoricalResults: async () => [
        { lga: "Akko", ward: "Tumfure", results: { PDP: 3000, APC: 3200 } },
      ],
      getSupporterDistribution: async () => [{ ward: "Tumfure", count: 45 }],
    };

    const result = await handleStrategyRequest({ kind: "ward_targeting", campaignId }, deps);

    expect(result.wards).toHaveLength(2);
    expect(result.wards[0].priority).toBe("critical");
    expect(result.overallStrategy).toContain("Akko");
  });

  it("throws on missing campaign", async () => {
    const deps: StrategyAgentDeps = {
      llm: { chat: async () => ({ content: "{}", inputTokens: 0, outputTokens: 0 }) },
      getCampaign: async () => null,
      getHistoricalResults: async () => [],
      getSupporterDistribution: async () => [],
    };

    await expect(
      handleStrategyRequest({ kind: "ward_targeting", campaignId }, deps),
    ).rejects.toThrow("not found");
  });
});
