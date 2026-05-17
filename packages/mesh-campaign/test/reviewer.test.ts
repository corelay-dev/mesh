import { describe, it, expect } from "vitest";
import { reviewContent } from "../src/compliance/reviewer.js";
import type { CampaignPromptContext } from "../src/memory/prompt-builder.js";
import type { LLMClient } from "@corelay/mesh-core";

function mockLLM(responses: string[]): LLMClient {
  let callIndex = 0;
  return {
    chat: async () => {
      const content = responses[callIndex] ?? "[]";
      callIndex++;
      return { content, inputTokens: 50, outputTokens: 30 };
    },
  };
}

const baseCtx: CampaignPromptContext = {
  candidateProfile: ["Test Candidate"],
  keyPolicies: [],
  donts: ["Do not mention religion"],
  brandVoice: null,
  learnedRules: [],
  historicalPerformance: [],
};

describe("compliance/reviewer (full integration)", () => {
  it("passes clean content through all layers including Critic", async () => {
    // LLM review returns [] (no issues), Critic approves (returns APPROVED internally)
    // Critic calls: 1 critique call that returns "APPROVED"
    const llm = mockLLM([
      "[]",       // Layer 2: LLM review — no issues
      "APPROVED", // Layer 3: Critic critique — approved first time
    ]);

    const result = await reviewContent("Vote for progress in Gombe State.", baseCtx, llm);
    expect(result.passed).toBe(true);
    expect(result.notes).toContain("Critic approved");
  });

  it("fails on static rules before reaching LLM or Critic", async () => {
    const llm = mockLLM([]); // Should never be called
    const result = await reviewContent("We will destroy them all!", baseCtx, llm);
    expect(result.passed).toBe(false);
    expect(result.issues[0]).toContain("destroy them");
  });

  it("fails on LLM review before reaching Critic", async () => {
    const llm = mockLLM([
      JSON.stringify(["Potentially defamatory claim about opponent"]),
    ]);

    const result = await reviewContent("The opponent stole billions from the treasury.", baseCtx, llm);
    expect(result.passed).toBe(false);
    expect(result.issues[0]).toContain("defamatory");
  });

  it("fails when Critic flags subtle issues", async () => {
    // LLM review passes, but Critic catches something subtle
    // Critic internally: critique returns issue → revise → returns revised content
    // When verdict.revised === true, we fail
    const llm = mockLLM([
      "[]",                                    // Layer 2: LLM review passes
      "This contains a subtle ethnic dog-whistle targeting Fulani communities", // Critic critique — not APPROVED
      "Revised content without the dog-whistle", // Critic revision
      "APPROVED", // Critic second critique — approves revised version
    ]);

    const result = await reviewContent("Our people know who the real indigenes are.", baseCtx, llm);
    // The Critic revised the content, meaning it found issues
    expect(result.passed).toBe(false);
    expect(result.issues[0]).toContain("Critic revision required");
  });

  it("respects campaign-specific donts", async () => {
    const ctx: CampaignPromptContext = {
      ...baseCtx,
      donts: ["Do not attack opponent education record"],
    };
    const llm = mockLLM([]);
    const result = await reviewContent(
      "The opponent failed on education and has a terrible record on schools",
      ctx,
      llm,
    );
    expect(result.passed).toBe(false);
    expect(result.issues[0]).toContain("campaign rule");
  });
});
