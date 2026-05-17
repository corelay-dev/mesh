import { describe, it, expect } from "vitest";
import { formatBrandVoiceForPrompt, type BrandVoice } from "../src/memory/brand-voice.js";

describe("memory/brand-voice", () => {
  const voice: BrandVoice = {
    campaignId: "00000000-0000-0000-0000-000000000001",
    tone: "authoritative but approachable",
    vocabulary: ["progress", "accountability", "our people"],
    forbidden: ["enemy", "crush", "annihilate"],
    personality: "A seasoned leader who listens before acting",
    samplePosts: ["Together we build a better Lagos. One ward at a time."],
  };

  it("formats brand voice into prompt section", () => {
    const result = formatBrandVoiceForPrompt(voice);
    expect(result).toContain("Brand Voice Guidelines");
    expect(result).toContain("authoritative but approachable");
    expect(result).toContain("progress, accountability, our people");
    expect(result).toContain("enemy, crush, annihilate");
    expect(result).toContain("Together we build");
  });

  it("handles empty arrays gracefully", () => {
    const minimal: BrandVoice = {
      campaignId: "00000000-0000-0000-0000-000000000001",
      tone: "casual",
      vocabulary: [],
      forbidden: [],
      personality: "Friendly",
      samplePosts: [],
    };
    const result = formatBrandVoiceForPrompt(minimal);
    expect(result).toContain("casual");
    expect(result).not.toContain("Preferred vocabulary");
    expect(result).not.toContain("Never use");
  });
});
