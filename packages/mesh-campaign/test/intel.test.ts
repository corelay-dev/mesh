import { describe, it, expect } from "vitest";
import { handleIntelRequest, type IntelAgentDeps } from "../src/agents/intel.js";
import type { LLMClient } from "@corelay/mesh-core";

function mockLLM(response: string): LLMClient {
  return {
    chat: async () => ({ content: response, inputTokens: 100, outputTokens: 50 }),
  };
}

describe("agents/intel", () => {
  const campaignId = "00000000-0000-0000-0000-000000000001";

  it("analyzes sentiment and returns structured report", async () => {
    const report = {
      overallSentiment: "negative",
      keyThemes: ["road infrastructure", "insecurity"],
      opponentMoves: [{ actor: "APC", action: "Released attack ad on education", threat: "high" }],
      recommendations: ["Counter with education stats from 2023"],
    };

    const deps: IntelAgentDeps = {
      llm: mockLLM(JSON.stringify(report)),
      getCampaign: async () => ({ candidateName: "Musa", state: "Gombe" }),
      getRecentActivity: async () => ({ resultsLast24h: [], messageStats: [], supporterCounts: [] }),
    };

    const result = await handleIntelRequest(
      { kind: "sentiment", campaignId, inputs: ["People are angry about roads", "APC rally was huge"] },
      deps,
    );

    expect(result).toHaveProperty("overallSentiment", "negative");
    expect((result as any).opponentMoves[0].threat).toBe("high");
  });

  it("generates daily brief from activity data", async () => {
    const deps: IntelAgentDeps = {
      llm: mockLLM(""),
      getCampaign: async () => ({ candidateName: "Musa", state: "Gombe" }),
      getRecentActivity: async () => ({
        resultsLast24h: [{ lga: "Akko", count: 12 }],
        messageStats: [{ status: "sent", count: 45 }],
        supporterCounts: [{ tier: "agent", count: 200 }, { tier: "volunteer", count: 500 }],
      }),
    };

    const result = await handleIntelRequest({ kind: "daily_brief", campaignId }, deps);

    expect(typeof result).toBe("string");
    expect(result as string).toContain("Akko");
    expect(result as string).toContain("45");
    expect(result as string).toContain("agent: 200");
  });

  it("throws on missing campaign", async () => {
    const deps: IntelAgentDeps = {
      llm: mockLLM(""),
      getCampaign: async () => null,
      getRecentActivity: async () => ({ resultsLast24h: [], messageStats: [], supporterCounts: [] }),
    };

    await expect(
      handleIntelRequest({ kind: "sentiment", campaignId, inputs: ["test"] }, deps),
    ).rejects.toThrow("not found");
  });
});
