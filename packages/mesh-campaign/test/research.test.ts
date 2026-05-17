import { describe, it, expect } from "vitest";
import { handleResearchRequest, type ResearchAgentDeps } from "../src/agents/research.js";

describe("agents/research", () => {
  const campaignId = "00000000-0000-0000-0000-000000000001";

  it("verifies claims and returns structured result", async () => {
    const verification = {
      claims: [
        { claim: "PDP built 50km of roads", verdict: "verified", evidence: "State records confirm 48km completed", source: "Gombe State Works Ministry" },
      ],
      overallReliability: "high",
      suggestedRevisions: [],
    };

    const deps: ResearchAgentDeps = {
      llm: { chat: async () => ({ content: JSON.stringify(verification), inputTokens: 100, outputTokens: 150 }) },
    };

    const result = await handleResearchRequest(
      { kind: "verify_claims", campaignId, claims: ["PDP built 50km of roads"] },
      deps,
    );

    expect(result.claims[0].verdict).toBe("verified");
    expect(result.overallReliability).toBe("high");
  });

  it("uses web search when provided", async () => {
    let searchCalled = false;
    const verification = {
      claims: [{ claim: "test", verdict: "unverified", evidence: "No data", source: null }],
      overallReliability: "low",
      suggestedRevisions: ["Remove unverifiable claim"],
    };

    const deps: ResearchAgentDeps = {
      llm: { chat: async () => ({ content: JSON.stringify(verification), inputTokens: 100, outputTokens: 100 }) },
      webSearch: async (query) => {
        searchCalled = true;
        return [{ title: "Result", snippet: "Some info", url: "https://example.com" }];
      },
    };

    await handleResearchRequest(
      { kind: "verify_claims", campaignId, claims: ["Unverifiable claim"] },
      deps,
    );

    expect(searchCalled).toBe(true);
  });
});
