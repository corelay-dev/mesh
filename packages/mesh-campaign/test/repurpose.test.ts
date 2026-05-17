import { describe, it, expect } from "vitest";
import { runRepurposeWorkflow } from "../src/workflows/repurpose.js";
import type { LLMClient } from "@corelay/mesh-core";

describe("workflows/repurpose", () => {
  const campaignId = "00000000-0000-0000-0000-000000000001";

  it("generates multi-post campaign from source content", async () => {
    const planResponse = JSON.stringify({
      posts: [
        { index: 1, platform: "twitter", content: "Short tweet about roads", hook: "50km of new roads!", suggestedMedia: "quote card" },
        { index: 2, platform: "facebook", content: "Longer post about infrastructure progress", hook: "Progress report:", suggestedMedia: "infographic" },
        { index: 3, platform: "whatsapp_status", content: "Na we dey build am!", hook: "See wetin PDP don do", suggestedMedia: "photo" },
      ],
    });

    const llm: LLMClient = {
      chat: async () => ({ content: planResponse, inputTokens: 500, outputTokens: 400 }),
    };

    const result = await runRepurposeWorkflow({
      campaignId,
      sourceContent: "The governor today commissioned 50km of road infrastructure in Akko LGA, connecting 12 communities to the state capital...",
      sourceType: "press_release",
      targetPlatforms: ["twitter", "facebook", "whatsapp_status"],
      language: "en",
      postCount: 3,
    }, llm);

    expect(result.posts).toHaveLength(3);
    expect(result.posts[0].platform).toBe("twitter");
    expect(result.posts[2].platform).toBe("whatsapp_status");
    expect(result.campaignPlan).toBeTruthy();
  });

  it("returns empty posts on malformed LLM response", async () => {
    const llm: LLMClient = {
      chat: async () => ({ content: "not json at all", inputTokens: 50, outputTokens: 20 }),
    };

    const result = await runRepurposeWorkflow({
      campaignId,
      sourceContent: "Some speech content that is long enough to pass validation easily here.",
      sourceType: "speech",
      targetPlatforms: ["twitter"],
      language: "pcm",
      postCount: 2,
    }, llm);

    expect(result.posts).toHaveLength(0);
    expect(result.campaignPlan).toBe("not json at all");
  });
});
