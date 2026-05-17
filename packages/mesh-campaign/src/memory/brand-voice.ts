import { z } from "zod";

export const BrandVoiceSchema = z.object({
  campaignId: z.string().uuid(),
  tone: z.string().describe("e.g., 'authoritative but approachable', 'grassroots and passionate'"),
  vocabulary: z.array(z.string()).describe("Preferred words/phrases to use"),
  forbidden: z.array(z.string()).describe("Words/phrases to never use"),
  personality: z.string().describe("How the candidate should come across"),
  samplePosts: z.array(z.string()).default([]).describe("Example posts that capture the voice"),
});
export type BrandVoice = z.infer<typeof BrandVoiceSchema>;

export interface BrandVoiceStore {
  get(campaignId: string): Promise<BrandVoice | null>;
  set(voice: BrandVoice): Promise<void>;
}

export function formatBrandVoiceForPrompt(voice: BrandVoice): string {
  const sections: string[] = [
    "## Brand Voice Guidelines",
    `**Tone:** ${voice.tone}`,
    `**Personality:** ${voice.personality}`,
  ];

  if (voice.vocabulary.length > 0) {
    sections.push(`**Preferred vocabulary:** ${voice.vocabulary.join(", ")}`);
  }
  if (voice.forbidden.length > 0) {
    sections.push(`**Never use:** ${voice.forbidden.join(", ")}`);
  }
  if (voice.samplePosts.length > 0) {
    sections.push("**Example posts that capture our voice:**");
    for (const sample of voice.samplePosts) {
      sections.push(`- "${sample}"`);
    }
  }

  return sections.join("\n");
}
