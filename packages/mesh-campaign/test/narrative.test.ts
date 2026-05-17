import { describe, it, expect } from "vitest";
import { handleNarrativeRequest, type NarrativeAgentDeps } from "../src/agents/narrative.js";
import { MemoryContextStore } from "../src/memory/context-store.js";
import type { LLMClient } from "@corelay/mesh-core";

function mockLLM(response: string): LLMClient {
  return {
    chat: async () => ({ content: response, inputTokens: 100, outputTokens: 50 }),
  };
}

describe("agents/narrative", () => {
  const campaignId = "00000000-0000-0000-0000-000000000001";
  const contextStore = new MemoryContextStore();
  contextStore.set(campaignId, {
    candidateProfile: ["Alhaji Musa Dankwambo — PDP candidate for Gombe State"],
    keyPolicies: ["Road infrastructure", "Education reform"],
    donts: ["Do not attack opponent's family"],
    brandVoice: null,
    learnedRules: ["Use conversational tone on Twitter"],
    historicalPerformance: [],
  });

  it("generates a single message", async () => {
    const deps: NarrativeAgentDeps = {
      llm: mockLLM("Our roads, our future. Vote PDP for real change in Gombe."),
      contextStore,
    };

    const results = await handleNarrativeRequest(
      { kind: "generate", campaignId, task: "Rally announcement for Gombe", channel: "twitter", language: "en" },
      deps,
    );

    expect(results).toHaveLength(1);
    expect(results[0].content).toContain("roads");
  });

  it("generates batch messages from JSON response", async () => {
    const batchResponse = JSON.stringify({
      messages: [
        { content: "Post 1", tone: "inspiring", targetAudience: "youth" },
        { content: "Post 2", tone: "urgent", targetAudience: "women" },
      ],
    });
    const deps: NarrativeAgentDeps = { llm: mockLLM(batchResponse), contextStore };

    const results = await handleNarrativeRequest(
      { kind: "batch", campaignId, task: "Mobilize youth", channel: "whatsapp", language: "pcm", count: 2 },
      deps,
    );

    expect(results).toHaveLength(2);
    expect(results[0].tone).toBe("inspiring");
    expect(results[1].targetAudience).toBe("women");
  });

  it("falls back to raw content when batch JSON is malformed", async () => {
    const deps: NarrativeAgentDeps = { llm: mockLLM("Just a plain text response"), contextStore };

    const results = await handleNarrativeRequest(
      { kind: "batch", campaignId, task: "Test", channel: "sms", language: "en", count: 3 },
      deps,
    );

    expect(results).toHaveLength(1);
    expect(results[0].content).toBe("Just a plain text response");
  });

  it("generates counter-narrative", async () => {
    const deps: NarrativeAgentDeps = {
      llm: mockLLM("Our candidate delivered 50km of roads in 2023. The facts speak for themselves."),
      contextStore,
    };

    const results = await handleNarrativeRequest(
      { kind: "counter", campaignId, opponentClaim: "PDP did nothing for roads", channel: "twitter", language: "en" },
      deps,
    );

    expect(results).toHaveLength(1);
    expect(results[0].tone).toBe("counter-narrative");
    expect(results[0].content).toContain("roads");
  });
});
